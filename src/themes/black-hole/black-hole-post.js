/**
 * Black Hole Theme - WebGPU Post Processing
 * Emissive-only bloom + bounded lensing/chromatic fallback + vignette (WebGPU path)
 */

import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    clamp,
    Fn,
    float,
    length,
    mix,
    smoothstep,
    vec2,
    vec3,
    vec4,
    dot,
    hash,
    max,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';

const BLOOM_DOWNSAMPLE_MIN = 0.25;
const BLOOM_DOWNSAMPLE_MAX = 1.0;
const BLOOM_DOWNSAMPLE_STEP = 1 / 32;
const UNIFORM_EPSILON = 1e-5;

function sanitizeBloomDownsample(value, fallback = 0.8) {
    const numeric = Number.isFinite(value) ? value : fallback;
    const clamped = THREE.MathUtils.clamp(
        numeric,
        BLOOM_DOWNSAMPLE_MIN,
        BLOOM_DOWNSAMPLE_MAX,
    );
    return Math.round(clamped / BLOOM_DOWNSAMPLE_STEP) * BLOOM_DOWNSAMPLE_STEP;
}

function setNumberUniform(node, value, epsilon = UNIFORM_EPSILON) {
    if (!node || !Number.isFinite(value)) return;
    if (Math.abs(node.value - value) <= epsilon) return;
    node.value = value;
}

function readVector2(value) {
    let components = null;
    if (value?.isVector2) components = [value.x, value.y];
    else if (Array.isArray(value) && value.length >= 2) components = [value[0], value[1]];
    else if (value) components = [value.x, value.y];

    if (components?.every(Number.isFinite)) return components;
    return null;
}

export class BlackHolePost {
    constructor(renderer, scene, camera, params = {}) {
        this.renderer = renderer;
        this.useMRT = params.useMRT ?? true;
        this.bloomDownsample = sanitizeBloomDownsample(params.bloomDownsample, 0.8);
        this.enableLensing = params.enableLensing === true;
        this.enableChromatic = params.enableChromatic ?? true;
        this.postProcessing = new THREE.PostProcessing(renderer);

        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(mrt({ output, emissive }));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : sceneColor;

        const bloomStrength = params.bloomStrength ?? 0.5;
        const bloomRadius = params.bloomRadius ?? 0.6;
        const bloomThreshold = params.bloomThreshold ?? 0.15;
        this.bloomNode = bloom(bloomSource, bloomStrength, bloomRadius, bloomThreshold);

        // BloomNode.updateBefore() owns sizing in r181 and obtains drawing-buffer pixels from
        // the renderer. Keep the tier downsample there, rather than also resizing from the
        // theme's CSS-pixel resize callback. The effective-size cache prevents the stock
        // BloomNode from touching eleven render targets when neither pixels nor the quantized
        // adaptive scale changed.
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomSize = { width: 0, height: 0 };
        this.bloomNode.setSize = (width, height) => {
            const effectiveWidth = Math.max(32, Math.round(width * this.bloomDownsample));
            const effectiveHeight = Math.max(32, Math.round(height * this.bloomDownsample));
            if (
                effectiveWidth === this.bloomSize.width
                && effectiveHeight === this.bloomSize.height
            ) return;

            this.bloomSize.width = effectiveWidth;
            this.bloomSize.height = effectiveHeight;
            originalBloomSetSize(effectiveWidth, effectiveHeight);
        };

        this.uChromaticStrength = uniform(params.chromaticStrength ?? 0.0006);
        this.uVignetteOffset = uniform(params.vignetteOffset ?? 1.2);
        this.uVignetteDarkness = uniform(params.vignetteDarkness ?? 0.5);
        this.uExposure = uniform(params.exposure ?? 1.05);
        this.uContrast = uniform(params.contrast ?? 1.04);
        this.uSaturation = uniform(params.saturation ?? 1.08);
        this.uTintStrength = uniform(params.tintStrength ?? 0.22);
        this.uDitherStrength = uniform(params.ditherStrength ?? 0.0);
        this.uTint = uniform(new THREE.Color(1.04, 0.98, 1.08));

        const initialLensCenter = readVector2(params.lensCenter ?? params.bhScreenPos)
            ?? [0.5, 0.5];
        this.uLensCenter = uniform(new THREE.Vector2(initialLensCenter[0], initialLensCenter[1]));
        this.uLensStrength = uniform(THREE.MathUtils.clamp(
            params.lensStrength ?? params.lensingStrength ?? 0.018,
            0.0,
            0.08,
        ));
        this.uLensRadius = uniform(THREE.MathUtils.clamp(params.lensRadius ?? 0.34, 0.08, 0.65));
        this.uLensInnerRadius = uniform(THREE.MathUtils.clamp(
            params.lensInnerRadius ?? 0.075,
            0.0,
            0.25,
        ));
        this.uLensAspect = uniform(1.0);

        const uv = viewportUV;

        // Vignette-at-UV sampling the scene texture directly. Mirrors the old
        // mix(baseSample*(1-darkness), baseSample, vignette). Wrapped in Fn so each chromatic
        // tap re-evaluates the vignette at its own UV — exactly what the old
        // chromaticAberration(vignetteColor, ...) did: it wraps its input in convertToTexture(),
        // forcing a full-screen render-to-texture pass EVERY frame purely so the R/G/B split
        // could re-sample the vignetted image. Inlining collapses that extra pass into the taps.
        // Pixel-identical (it even skips the intermediate RTT's requantization + bilinear resample).
        const sampleVignettedScene = Fn(([p]) => {
            const vigDist = length(p.sub(0.5).mul(2.0));
            const vig = float(1.0).sub(
                smoothstep(this.uVignetteOffset.sub(0.6), this.uVignetteOffset, vigDist),
            );
            const sampled = sceneColor.sample(p);
            return mix(
                sampled.mul(float(1.0).sub(this.uVignetteDarkness)),
                sampled,
                vig,
            );
        });

        let chroma;
        let bloomContribution = this.bloomNode;
        if (this.enableLensing) {
            // One scene tap, bounded to an annulus outside the shadow. UV distance is
            // aspect-correct, so the lens stays circular on ultrawide displays. This branch
            // intentionally replaces generic chromatic aberration; both graphs are never paid
            // for together, and the center is driven from the projected black-hole position.
            const lensDelta = uv.sub(this.uLensCenter);
            const lensDeltaAspect = vec2(lensDelta.x.mul(this.uLensAspect), lensDelta.y);
            const lensDistance = length(lensDeltaAspect);
            const safeDistance = max(lensDistance, float(0.0001));
            const safeRadius = max(this.uLensRadius, float(0.001));
            const safeInnerRadius = clamp(
                this.uLensInnerRadius,
                float(0.0),
                safeRadius.mul(0.75),
            );
            const innerSoftness = max(safeRadius.mul(0.12), float(0.008));
            const innerMask = smoothstep(
                safeInnerRadius,
                safeInnerRadius.add(innerSoftness),
                lensDistance,
            );
            const outerMask = float(1.0).sub(
                smoothstep(safeRadius.mul(0.42), safeRadius, lensDistance),
            );
            const radialProgress = clamp(
                lensDistance.sub(safeInnerRadius)
                    .div(max(safeRadius.sub(safeInnerRadius), float(0.001))),
                float(0.0),
                float(1.0),
            );
            const lensProfile = innerMask
                .mul(outerMask)
                .mul(float(1.0).sub(radialProgress.mul(0.65)));
            const bending = clamp(
                this.uLensStrength.mul(lensProfile),
                float(0.0),
                safeRadius.mul(0.16),
            );
            const radialDirection = vec2(
                lensDeltaAspect.x.div(this.uLensAspect),
                lensDeltaAspect.y,
            ).div(safeDistance);
            const lensedUV = clamp(
                uv.sub(radialDirection.mul(bending)),
                vec2(0.001),
                vec2(0.999),
            );
            chroma = sampleVignettedScene(lensedUV);
            // Bloom is an optical halo, but it must not paint over the event
            // horizon. Preserve a near-black central silhouette even when a
            // high-tier combo drives the photon ring and disk to peak energy.
            const shadowPreserve = smoothstep(
                safeInnerRadius.mul(0.62),
                safeInnerRadius.mul(1.05),
                lensDistance,
            );
            bloomContribution = this.bloomNode.mul(mix(float(0.035), float(1.0), shadowPreserve));
        } else if (this.enableChromatic) {
            // Mirrors ChromaticAberrationNode(strength, center=(0.5,0.5), scale=1.1) term-for-term.
            const caCenter = vec2(0.5, 0.5);
            const caScale = float(1.1);
            const caStrength = this.uChromaticStrength;
            const caOffset = uv.sub(caCenter);
            const caDist = length(caOffset);
            const redScale = float(1.0).add(caScale.mul(0.02).mul(caStrength));
            const blueScale = float(1.0).sub(caScale.mul(0.02).mul(caStrength));
            const aberration = caStrength.mul(caDist);
            const redUV = caCenter.add(caOffset.mul(redScale)).add(caOffset.mul(aberration).mul(0.01));
            const blueUV = caCenter.add(caOffset.mul(blueScale)).add(caOffset.mul(aberration).mul(-0.01));
            const centerSample = sampleVignettedScene(uv); // green + alpha (greenUV == uv, gOffset = 0)
            const redSample = sampleVignettedScene(redUV);
            const blueSample = sampleVignettedScene(blueUV);
            chroma = vec4(redSample.r, centerSample.g, blueSample.b, centerSample.a);
        } else {
            chroma = sampleVignettedScene(uv);
        }
        const combined = chroma.add(bloomContribution);

        const exposed = combined.rgb.mul(this.uExposure);
        const acesA = float(2.51);
        const acesB = float(0.03);
        const acesC = float(2.43);
        const acesD = float(0.59);
        const acesE = float(0.14);
        const acesNum = exposed.mul(exposed.mul(acesA).add(acesB));
        const acesDen = exposed.mul(exposed.mul(acesC).add(acesD)).add(acesE);
        let graded = clamp(acesNum.div(acesDen), float(0.0), float(1.0));

        const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
        graded = mix(vec3(luma), graded, this.uSaturation);
        graded = graded.sub(0.5).mul(this.uContrast).add(0.5);
        graded = mix(graded, graded.mul(this.uTint), this.uTintStrength);

        // Stable screen-space dither prevents banding in the deep-space gradients. This is a
        // tiny ALU-only graph and keeps the existing runtime ditherStrength API meaningful.
        const ditherNoise = hash(uv.mul(vec2(173.3, 271.9)));
        const dither = ditherNoise.sub(0.5).mul(this.uDitherStrength);
        const finalColor = clamp(graded.add(vec3(dither)), float(0.0), float(1.0));

        this.postProcessing.outputNode = vec4(finalColor, chroma.a);
        this.postProcessing.needsUpdate = true;
        this.size = { width: 0, height: 0 };
    }

    update(params = {}) {
        if (params.bloomStrength !== undefined) {
            setNumberUniform(this.bloomNode.strength, params.bloomStrength);
        }
        if (params.bloomRadius !== undefined) {
            setNumberUniform(this.bloomNode.radius, params.bloomRadius);
        }
        if (params.bloomThreshold !== undefined) {
            setNumberUniform(this.bloomNode.threshold, params.bloomThreshold);
        }
        if (this.enableChromatic && !this.enableLensing && params.chromaticStrength !== undefined) {
            setNumberUniform(this.uChromaticStrength, params.chromaticStrength);
        }
        if (params.vignetteOffset !== undefined) {
            setNumberUniform(this.uVignetteOffset, params.vignetteOffset);
        }
        if (params.vignetteDarkness !== undefined) {
            setNumberUniform(this.uVignetteDarkness, params.vignetteDarkness);
        }
        if (params.exposure !== undefined) {
            setNumberUniform(this.uExposure, params.exposure);
        }
        if (params.contrast !== undefined) {
            setNumberUniform(this.uContrast, params.contrast);
        }
        if (params.saturation !== undefined) {
            setNumberUniform(this.uSaturation, params.saturation);
        }
        if (params.tintStrength !== undefined) {
            setNumberUniform(this.uTintStrength, params.tintStrength);
        }
        if (params.ditherStrength !== undefined) {
            setNumberUniform(this.uDitherStrength, params.ditherStrength);
        }
        const nextLensStrength = params.lensStrength ?? params.lensingStrength;
        if (nextLensStrength !== undefined) {
            setNumberUniform(
                this.uLensStrength,
                THREE.MathUtils.clamp(nextLensStrength, 0.0, 0.08),
            );
        }
        if (params.lensRadius !== undefined) {
            setNumberUniform(
                this.uLensRadius,
                THREE.MathUtils.clamp(params.lensRadius, 0.08, 0.65),
            );
        }
        if (params.lensInnerRadius !== undefined) {
            setNumberUniform(
                this.uLensInnerRadius,
                THREE.MathUtils.clamp(params.lensInnerRadius, 0.0, 0.25),
            );
        }
        const nextLensCenter = readVector2(params.lensCenter ?? params.bhScreenPos);
        if (nextLensCenter) {
            const [x, y] = nextLensCenter;
            if (
                Number.isFinite(x)
                && Number.isFinite(y)
                && (
                    Math.abs(this.uLensCenter.value.x - x) > UNIFORM_EPSILON
                    || Math.abs(this.uLensCenter.value.y - y) > UNIFORM_EPSILON
                )
            ) {
                this.uLensCenter.value.set(x, y);
            }
        }
        if (params.bloomDownsample !== undefined) {
            const nextDownsample = sanitizeBloomDownsample(
                params.bloomDownsample,
                this.bloomDownsample,
            );
            if (nextDownsample !== this.bloomDownsample) this.bloomDownsample = nextDownsample;
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (height > 0) {
            setNumberUniform(
                this.uLensAspect,
                THREE.MathUtils.clamp(width / height, 0.25, 4.0),
            );
        }
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
