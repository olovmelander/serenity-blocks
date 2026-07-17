/* eslint-disable import/no-unresolved */
/**
 * Electric Dreams V3 — Post Pipeline
 *
 * Modern TSL-based post stack. Uses the three.js WebGPU PostProcessing class
 * (r181-compatible) until r183 RenderPipeline is available across the codebase.
 *
 * Stack (in order):
 *   1. MRT bloom from emissive channel (selective — only emissive surfaces glow)
 *   2. Chromatic aberration (radial, strength scales with distance from center)
 *   3. Vignette (smooth dark falloff at edges)
 *   4. ACES filmic tonemap (industry-standard cinematic curve)
 *   5. Saturation + contrast grade
 *   6. Film grain + dither (anti-banding)
 *
 * NOT included in V3 Phase 1 (added in Phase 7):
 *   - Motion blur (needs velocity buffer from Phase 1b)
 *   - Bokeh DOF (needs depth-aware focal plane)
 *   - LUT color grade (texture-driven, low priority)
 *   - TAAU temporal upsampling (its own substantial implementation)
 *
 * Quality knobs are profile-driven; runtime updates flow through updateDynamic().
 */
import * as WEBGPU from 'three/webgpu';
import {
    abs,
    clamp,
    dot,
    emissive,
    float,
    fract,
    length,
    max,
    mix,
    mrt,
    output,
    pass,
    sin,
    smoothstep,
    uniform,
    vec2,
    vec3,
    vec4,
    viewportUV,
} from 'three/tsl';
import * as THREE from 'three';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';

export const V3_POST_PROFILES = Object.freeze({
    Minimal: Object.freeze({
        enabled: false,
        bloomStrength: 0,
        bloomRadius: 0.5,
        bloomThreshold: 0.25,
        exposure: 1.0,
        contrast: 1.02,
        saturation: 1.0,
        vignetteDarkness: 0.2,
        chromaticStrength: 0,
        grainStrength: 0,
        ditherStrength: 0.001,
    }),
    Low: Object.freeze({
        enabled: true,
        bloomStrength: 0.32,
        bloomRadius: 0.55,
        bloomThreshold: 0.20,
        exposure: 0.96,
        contrast: 1.12,
        saturation: 1.12,
        vignetteDarkness: 0.32,
        chromaticStrength: 0.0014,
        grainStrength: 0.0014,
        ditherStrength: 0.0014,
    }),
    Medium: Object.freeze({
        enabled: true,
        bloomStrength: 0.44,
        bloomRadius: 0.58,
        bloomThreshold: 0.18,
        exposure: 0.94,
        contrast: 1.17,
        saturation: 1.16,
        vignetteDarkness: 0.46,
        chromaticStrength: 0.0024,
        grainStrength: 0.0022,
        ditherStrength: 0.0017,
    }),
    High: Object.freeze({
        enabled: true,
        bloomStrength: 0.54,
        bloomRadius: 0.62,
        bloomThreshold: 0.16,
        exposure: 0.93,
        contrast: 1.19,
        saturation: 1.18,
        vignetteDarkness: 0.56,
        chromaticStrength: 0.0034,
        grainStrength: 0.0028,
        ditherStrength: 0.0019,
    }),
    Ultra: Object.freeze({
        enabled: true,
        bloomStrength: 0.62,
        bloomRadius: 0.64,
        bloomThreshold: 0.14,
        exposure: 0.92,
        contrast: 1.21,
        saturation: 1.20,
        vignetteDarkness: 0.62,
        chromaticStrength: 0.0042,
        grainStrength: 0.0034,
        ditherStrength: 0.0021,
    }),
    Extreme: Object.freeze({
        enabled: true,
        bloomStrength: 0.72,
        bloomRadius: 0.68,
        bloomThreshold: 0.12,
        exposure: 0.92,
        contrast: 1.22,
        saturation: 1.22,
        vignetteDarkness: 0.7,
        chromaticStrength: 0.0055,
        grainStrength: 0.0038,
        ditherStrength: 0.0024,
    }),
});

export function getV3PostProfile(qualityName) {
    return { ...(V3_POST_PROFILES[qualityName] || V3_POST_PROFILES.High) };
}

export class V3PostPipeline {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.lastRenderCostMs = 0;
        this.mrtEnabled = params.useMRT !== false; // Default ON — controlled by capability check
        this.postProcessing = null;
        this._lastFrameStart = 0;

        // Detect WebGPU. V3 is WebGPU-only (no WebGL fallback at the post layer).
        if (renderer?.backend?.isWebGPUBackend !== true) {
            console.warn('[ElectricDreamsV3] Post pipeline requires WebGPU; skipping');
            return;
        }
        this._setupWebGPU(params);
    }

    _setupWebGPU(params) {
        this.postProcessing = new WEBGPU.PostProcessing(this.renderer);
        const scenePass = pass(this.scene, this.camera);

        // MRT: split scene rendering into color + emissive targets so bloom
        // operates ONLY on the emissive channel. Non-emissive surfaces don't bloom.
        // If the GPU rejects MRT (rare), fall back to single-target and bloom everything.
        let bloomSource;
        try {
            if (this.mrtEnabled) {
                scenePass.setMRT(mrt({ output, emissive }));
                bloomSource = scenePass.getTextureNode('emissive');
            } else {
                bloomSource = scenePass.getTextureNode('output');
            }
        } catch (err) {
            console.warn('[ElectricDreamsV3] MRT init failed; falling back to non-selective bloom:', err.message);
            this.mrtEnabled = false;
            bloomSource = scenePass.getTextureNode('output');
        }
        const sceneColor = scenePass.getTextureNode('output');

        this.bloomNode = bloom(
            bloomSource,
            params.bloomStrength ?? 0.55,
            params.bloomRadius ?? 0.6,
            params.bloomThreshold ?? 0.16,
        );

        // Uniforms — runtime-mutable via updateDynamic().
        this.uExposure = uniform(params.exposure ?? 0.93);
        this.uContrast = uniform(params.contrast ?? 1.19);
        this.uSaturation = uniform(params.saturation ?? 1.18);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.5);
        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.003);
        this.uGrainStrength = uniform(params.grainStrength ?? 0.003);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.002);
        this.uTime = uniform(0);

        // ─── Board-halo overlay uniforms ───
        // Subtle screen-space rounded-rect glow around the game board area.
        // Lives in UV space (0..1). Strength 0 = disabled.
        // The halo is added BEFORE tonemap so ACES handles its highlights naturally.
        this.uBoardHaloCenter = uniform(new THREE.Vector2(0.5, 0.5)); // board rect center in UV
        this.uBoardHaloHalfSize = uniform(new THREE.Vector2(0.1, 0.32)); // board rect half-extents in UV
        this.uBoardHaloRadius = uniform(0.02); // corner radius in UV (rounded rect)
        this.uBoardHaloGlow = uniform(0.08); // glow falloff distance in UV
        this.uBoardHaloStrength = uniform(params.boardHaloStrength ?? 0);
        this.uBoardHaloColor = uniform(new THREE.Color(0xa86bff)); // soft purple/cyan accent

        // Build the post graph from the scene + bloom outputs.
        const uvNode = viewportUV;
        const centered = uvNode.sub(vec2(0.5, 0.5));
        const dist = length(centered);

        // Chromatic aberration: stronger toward edges (where eye focus is loose).
        const edgeBoost = float(1.0).add(dist.mul(0.6));
        const chromaOffset = centered.mul(this.uChromaticStrength).mul(edgeBoost);
        const sampleR = sceneColor.sample(uvNode.add(chromaOffset));
        const sampleG = sceneColor.sample(uvNode);
        const sampleB = sceneColor.sample(uvNode.sub(chromaOffset));
        const chroma = vec4(sampleR.r, sampleG.g, sampleB.b, sampleG.a);

        const withBloom = chroma.add(this.bloomNode);

        // ─── Board-halo: rounded-rect screen-space SDF + soft outer glow ───
        // SDF to a rounded rectangle in UV space:
        //   d = length(max(|uv-center| - halfSize + radius, 0)) - radius
        // d <= 0  → inside the rect
        // d > 0   → outside, value = distance to nearest rect edge
        // We want the halo to live ONLY outside the rect (so it doesn't paint
        // over the game board), with falloff over `uBoardHaloGlow` distance.
        const boardLocal = uvNode.sub(this.uBoardHaloCenter);
        const boardAbs = vec2(abs(boardLocal.x), abs(boardLocal.y));
        const rectInner = vec2(
            max(boardAbs.x.sub(this.uBoardHaloHalfSize.x).add(this.uBoardHaloRadius), float(0.0)),
            max(boardAbs.y.sub(this.uBoardHaloHalfSize.y).add(this.uBoardHaloRadius), float(0.0)),
        );
        const boardSDF = length(rectInner).sub(this.uBoardHaloRadius);
        // Outer-only glow: smoothstep gives strong falloff from edge outward.
        // Max(boardSDF, 0) clamps to "outside only" — no inside contribution.
        const haloT = max(boardSDF, float(0.0)).div(this.uBoardHaloGlow);
        const haloMask = smoothstep(float(1.0), float(0.0), haloT);
        const halo = vec3(
            this.uBoardHaloColor.r,
            this.uBoardHaloColor.g,
            this.uBoardHaloColor.b,
        ).mul(haloMask).mul(this.uBoardHaloStrength);
        const withHalo = vec4(withBloom.rgb.add(halo), withBloom.a);

        // Vignette: smooth dark falloff (smoothstep from 0.4 to 0.9 of radial dist).
        const vignetteFactor = smoothstep(0.9, 0.4, dist);
        const vignetted = mix(
            withHalo.rgb.mul(float(1.0).sub(this.uVignetteDarkness)),
            withHalo.rgb,
            vignetteFactor,
        );

        // ACES filmic tonemap — industry standard for cinematic feel.
        // Maps HDR → LDR with a smooth shoulder that preserves highlights.
        const exposed = vignetted.mul(this.uExposure);
        const acesNum = exposed.mul(exposed.mul(2.51).add(0.03));
        const acesDen = exposed.mul(exposed.mul(2.43).add(0.59)).add(0.14);
        let graded = clamp(acesNum.div(acesDen), 0.0, 1.0);

        // Saturation (luma-preserving) + contrast around 0.5 midpoint.
        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);

        // Film grain (anim) + dither (static). Adds anti-banding + cinematic texture.
        const grainSeed = uvNode.mul(132.0).add(vec2(this.uTime.mul(0.73), this.uTime.mul(1.17)));
        const grain = fract(
            sin(dot(grainSeed, vec2(12.9898, 78.233))).mul(43758.5453),
        ).sub(0.5).mul(this.uGrainStrength);
        const ditherSeed = uvNode.mul(317.0).add(vec2(0.17, 0.31));
        const dither = fract(
            sin(dot(ditherSeed, vec2(127.1, 269.5))).mul(43758.5453),
        ).sub(0.5).mul(this.uDitherStrength);

        const finalColor = clamp(graded.add(vec3(grain)).add(vec3(dither)), 0.0, 1.0);
        this.postProcessing.outputNode = vec4(finalColor, 1.0);
        this.postProcessing.needsUpdate = true;
    }

    isEnabled() {
        return this.postProcessing !== null;
    }

    /**
     * Configure the board-halo overlay (screen-space).
     * Coords are UV: 0..1 across the framebuffer.
     *   center, halfSize: vec2
     *   strength: 0..2 (typical 0.18-0.45)
     *   radius:  corner rounding in UV (0.01-0.04 typical)
     *   glow:    falloff distance in UV (0.04-0.14 typical)
     *   color:   THREE.Color
     */
    setBoardHalo({
        center, halfSize, strength, radius, glow, color,
    } = {}) {
        if (!this.uBoardHaloCenter) return;
        if (center) this.uBoardHaloCenter.value.copy(center);
        if (halfSize) this.uBoardHaloHalfSize.value.copy(halfSize);
        if (Number.isFinite(strength)) this.uBoardHaloStrength.value = strength;
        if (Number.isFinite(radius)) this.uBoardHaloRadius.value = radius;
        if (Number.isFinite(glow)) this.uBoardHaloGlow.value = glow;
        if (color) this.uBoardHaloColor.value.copy(color);
    }

    /**
     * Update static profile params (called on quality change).
     */
    setProfile(profile) {
        if (!this.postProcessing) return;
        if (this.bloomNode?.strength) this.bloomNode.strength.value = profile.bloomStrength;
        if (this.bloomNode?.radius) this.bloomNode.radius.value = profile.bloomRadius;
        if (this.bloomNode?.threshold) this.bloomNode.threshold.value = profile.bloomThreshold;
        this.uExposure.value = profile.exposure;
        this.uContrast.value = profile.contrast;
        this.uSaturation.value = profile.saturation;
        this.uVignetteDarkness.value = profile.vignetteDarkness;
        this.uChromaticStrength.value = profile.chromaticStrength;
        this.uGrainStrength.value = profile.grainStrength;
        this.uDitherStrength.value = profile.ditherStrength;
    }

    /**
     * Update runtime params (called every frame).
     * Pass a CACHED object — do not allocate new objects per frame.
     */
    updateDynamic(params) {
        if (!this.postProcessing) return;
        if (params.time !== undefined) this.uTime.value = params.time;
        if (params.bloomBoost !== undefined && this.bloomNode?.strength) {
            this.bloomNode.strength.value = (params.baseBloom || 0.5) + params.bloomBoost;
        }
        if (params.chromaticBoost !== undefined) {
            this.uChromaticStrength.value = (params.baseChromatic || 0.003) + params.chromaticBoost;
        }
        if (params.vignetteBoost !== undefined) {
            this.uVignetteDarkness.value = (params.baseVignette || 0.5) + params.vignetteBoost;
        }
        if (params.exposureDip !== undefined) {
            this.uExposure.value = (params.baseExposure || 0.93) - params.exposureDip;
        }
    }

    render() {
        const start = (typeof performance !== 'undefined') ? performance.now() : Date.now();
        this.postProcessing.render();
        this.lastRenderCostMs = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - start;
    }

    dispose() {
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing = null;
        this.bloomNode = null;
    }
}
