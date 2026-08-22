/**
 * Stillwater post pipeline — selective ivory bloom and one unified film grade.
 *
 * r185 contract:
 * - THREE.RenderPipeline (the r183+ name for the former PostProcessing)
 * - MRT emissive bloom is constructed only on tiers that enable it
 * - Low/Minimal construct neither MRT, BloomNode, nor a 3D LUT
 * - outputColorTransform is disabled because renderOutput performs the single
 *   final working-space to output-space transform.
 */

import * as THREE from 'three/webgpu';
import {
    dot,
    emissive,
    float,
    hash,
    mix,
    mrt,
    output,
    pass,
    renderOutput,
    screenUV,
    smoothstep,
    texture3D,
    toneMapping,
    uniform,
    vec3,
    vec4,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { disposeBloomNodeDeep } from '../../shared/bloom-dispose.js';
import {
    createStillwaterPainterly,
    createStillwaterPainterlyMask,
} from './stillwater-painterly.js';
import { getStillwaterQualityProfile } from '../stillwater-quality.js';
import { withEmissiveMaterialBlending } from '../../shared/mrt-blend.js';

const DEFAULT_BLOOM_STRENGTH = 0.48;
const DEFAULT_BLOOM_RADIUS = 0.62;
const DEFAULT_EXPOSURE = 0.90;

function resolveProfile(quality, qualityProfile) {
    if (qualityProfile?.name) {
        return getStillwaterQualityProfile(qualityProfile.name);
    }
    return getStillwaterQualityProfile(quality);
}
function smoothstepNumber(min, max, value) {
    const normalized = Math.min(1, Math.max(0, (value - min) / (max - min)));
    return normalized * normalized * (3 - 2 * normalized);
}

function lerpNumber(start, end, amount) {
    return start + (end - start) * amount;
}

function gradeLutSample(redInput, greenInput, blueInput) {
    let red = redInput;
    let green = greenInput;
    let blue = blueInput;
    let luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    const shadow = 1 - smoothstepNumber(0.06, 0.46, luma);
    const highlight = smoothstepNumber(0.54, 0.94, luma);

    // Teal-shadow / warm-highlight separation. The toe is lifted by a tiny
    // colored amount so darkness remains forest green rather than RGB black.
    red *= lerpNumber(1, 0.9, shadow * 0.24);
    green *= lerpNumber(1, 1.015, shadow * 0.24);
    blue *= lerpNumber(1, 1.045, shadow * 0.24);
    red += 0.052 * highlight;
    green += 0.021 * highlight;
    blue += 0.004 * highlight;
    red += 0.004 * shadow;
    green += 0.008 * shadow;
    blue += 0.006 * shadow;

    luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    red = lerpNumber(luma, red, 1.045);
    green = lerpNumber(luma, green, 1.045);
    blue = lerpNumber(luma, blue, 1.045);
    red = (red - 0.5) * 1.025 + 0.5;
    green = (green - 0.5) * 1.025 + 0.5;
    blue = (blue - 0.5) * 1.025 + 0.5;

    // --- Bauer chroma ceiling -------------------------------------------
    // Measured: the render sat p50 was 0.67 / p99 1.00 against a same-medium
    // reference at 0.59 / 0.90. Only near-white accents may keep chroma, so the
    // one warm lantern and the one pale spirit stay precious while the field
    // desaturates. Baked into the LUT rather than added as a pass — free.
    const value = Math.max(red, Math.max(green, blue));
    const minChannel = Math.min(red, Math.min(green, blue));
    if (value > 1e-5) {
        const saturation = (value - minChannel) / value;
        const ceiling = 0.88 + 0.10 * smoothstepNumber(0.72, 1, value);
        if (saturation > ceiling) {
            const keep = ceiling / saturation;
            red = value - (value - red) * keep;
            green = value - (value - green) * keep;
            blue = value - (value - blue) * keep;
        }
    }

    return [
        Math.min(1, Math.max(0, red)),
        Math.min(1, Math.max(0, green)),
        Math.min(1, Math.max(0, blue)),
    ];
}

/**
 * Build Stillwater's compact nonlinear teal/warm film grade.
 *
 * @param {number} [size=16]
 * @returns {THREE.Data3DTexture}
 */
export function createStillwaterGradeLut(size = 16) {
    const dimension = Math.max(2, Math.floor(size));
    const data = new Uint8Array(dimension * dimension * dimension * 4);
    let offset = 0;

    for (let blueIndex = 0; blueIndex < dimension; blueIndex += 1) {
        for (let greenIndex = 0; greenIndex < dimension; greenIndex += 1) {
            for (let redIndex = 0; redIndex < dimension; redIndex += 1) {
                const graded = gradeLutSample(
                    redIndex / (dimension - 1),
                    greenIndex / (dimension - 1),
                    blueIndex / (dimension - 1),
                );
                data[offset] = Math.round(graded[0] * 255);
                data[offset + 1] = Math.round(graded[1] * 255);
                data[offset + 2] = Math.round(graded[2] * 255);
                data[offset + 3] = 255;
                offset += 4;
            }
        }
    }

    const texture = new THREE.Data3DTexture(data, dimension, dimension, dimension);
    texture.name = 'stillwater-teal-warm-grade';
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    texture.userData.stillwaterLutSize = dimension;
    return texture;
}

/**
 * Resolve the structural post graph for a quality tier.
 */
export function getStillwaterPostConfig({
    quality = 'High',
    qualityProfile = null,
    bloomEnabled = true,
    painterlyEnabled = true,
    gradeMode = 'full',
} = {}) {
    const profile = resolveProfile(quality, qualityProfile);
    const normalizedGrade = String(gradeMode).toLowerCase() === 'aces' ? 'aces' : 'full';
    const useBloom = profile.bloom === true
        && profile.bloomScale > 0
        && bloomEnabled !== false;
    const lutSize = normalizedGrade === 'full' && profile.lutSize >= 2
        ? Math.floor(profile.lutSize)
        : 0;

    return Object.freeze({
        quality: profile.name,
        // Region flattening is premium-tier: it is the most expensive thing in
        // the chain, and the lean tiers exist precisely to avoid it.
        painterly: useBloom && normalizedGrade === 'full' && painterlyEnabled !== false,
        painterlyStrength: 0.85,
        // Solo board rect, normalized — mirrors STILLWATER_BOARD_SAFE_REGIONS.
        boardRect: Object.freeze({
            x: 0.32, y: 0.09, width: 0.36, height: 0.82,
        }),
        gradeMode: normalizedGrade,
        useBloom,
        useMRT: useBloom,
        bloomScale: useBloom ? profile.bloomScale : 0,
        lutSize,
        useLut: lutSize > 0,
        analyticGrade: normalizedGrade === 'full' && lutSize === 0,
    });
}

/**
 * Give a node material an explicit emissive MRT role. Passing null creates a
 * bright-but-non-emissive negative control that cannot enter selective bloom.
 */
export function configureStillwaterSelectiveBloomMaterial(material, emissiveNode = null) {
    if (!material) return material;
    const emission = emissiveNode || vec3(0);
    material.emissiveNode = emission;
    // Include the ordinary color output as well as the selective emissive
    // channel. The same material can then render into the lake reflector's
    // single named `output` target without producing an empty WGSL output
    // struct, while the main scene MRT still overrides only `emissive`.
    material.mrtNode = mrt({ output, emissive: emission });
    material.userData = {
        ...(material.userData || {}),
        emitsBloom: emissiveNode !== null,
        mrtRole: emissiveNode !== null ? 'stillwater-emissive' : 'stillwater-zero-emissive',
    };
    material.needsUpdate = true;
    return material;
}

export class StillwaterPipeline {
    constructor(renderer, scene, camera, {
        quality = 'High',
        qualityProfile = null,
        bloomEnabled = true,
        painterlyEnabled = true,
        gradeMode = 'full',
        bloomStrength = DEFAULT_BLOOM_STRENGTH,
        bloomRadius = DEFAULT_BLOOM_RADIUS,
        exposure = DEFAULT_EXPOSURE,
    } = {}) {
        if (!renderer || !scene || !camera) {
            throw new TypeError('StillwaterPipeline requires renderer, scene, and camera');
        }

        this.renderer = renderer;
        this.scene = scene;
        this.camera = camera;
        this.config = getStillwaterPostConfig({
            quality,
            qualityProfile,
            bloomEnabled,
            painterlyEnabled,
            gradeMode,
        });
        this.size = { width: 0, height: 0 };
        this.disposed = false;
        this.previousRendererState = {
            toneMapping: renderer.toneMapping,
            toneMappingExposure: renderer.toneMappingExposure,
        };

        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1;

        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        if (this.config.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const sceneColor = this.scenePass.getTextureNode('output');
        const baseSample = sceneColor.sample(screenUV);
        this.bloomNode = null;
        this.bloomCoreNode = null;
        this.bloomCombined = null;
        let hdrColor = baseSample.rgb;

        if (this.config.useBloom) {
            const bloomSource = this.scenePass.getTextureNode('emissive');
            this.bloomNode = bloom(
                bloomSource,
                bloomStrength,
                bloomRadius,
                0,
            );
            // Three wide glow mips are enough for Stillwater's restrained ivory
            // aura; the two widest default mips add fill without useful structure.
            this.bloomNode._nMips = 3;
            // Reduced-res internal targets through the r185 public API. The old
            // setSize monkey-patch would now scale twice: r185's setSize itself
            // multiplies by _resolutionScale (default 0.5).
            this.bloomNode.setResolutionScale(this.config.bloomScale);
            // Second tap: a tight, near-neutral core. A single bloom is forced to
            // choose between a foggy screen-wide veil and hot dots; two taps give
            // the lantern and the spirit a crisp core inside a large soft halo,
            // which is how a painter renders a light at night. The wide tap is
            // tinted warm because scattered light at night IS warmer than its
            // source, and the core stays neutral so the spirit reads as ivory
            // rather than amber.
            this.bloomCoreNode = bloom(
                bloomSource,
                bloomStrength * 0.55,
                0.25,
                0.85,
            );
            this.bloomCoreNode._nMips = 2;
            this.bloomCoreNode.setResolutionScale(this.config.bloomScale);
            this.bloomCombined = this.bloomNode.rgb
                .mul(vec3(1.06, 0.97, 0.86))
                .add(this.bloomCoreNode.rgb);
            if (!this.config.painterly) hdrColor = hdrColor.add(this.bloomCombined);
        }

        // Wave 4 — the brush. Region-flattening runs on the composed scene BEFORE
        // tone mapping, masked off the play field. Bloom is deliberately added
        // after, so the spirit's glow is not itself flattened into a patch.
        if (this.config.painterly) {
            const painterlyMask = createStillwaterPainterlyMask({
                board: this.config.boardRect,
            });
            hdrColor = createStillwaterPainterly({
                colorNode: sceneColor,
                strengthNode: painterlyMask.mul(this.config.painterlyStrength),
            });
            if (this.bloomCombined) hdrColor = hdrColor.add(this.bloomCombined);
        }

        this.uExposure = uniform(exposure);
        // Session arc. Sunrise never arrives, but the air thins and the key
        // lifts fractionally as it approaches — enough to feel, not to notice.
        this.uDawn = uniform(0);
        const aces = toneMapping(
            THREE.ACESFilmicToneMapping,
            this.uExposure,
            vec4(hdrColor.mul(float(1).add(this.uDawn.mul(0.16))), baseSample.a),
        );
        let graded = aces.rgb;

        this.lutTexture = null;
        if (this.config.useLut) {
            this.lutTexture = createStillwaterGradeLut(this.config.lutSize);
            graded = lut3D(
                vec4(graded, aces.a),
                texture3D(this.lutTexture),
                this.config.lutSize,
                0.94,
            ).rgb;
        } else if (this.config.analyticGrade) {
            const luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));
            const shadow = smoothstep(0.06, 0.46, luma).oneMinus();
            const highlight = smoothstep(0.54, 0.94, luma);
            const shadowTint = mix(
                vec3(1),
                vec3(0.9, 1.035, 0.985),
                shadow.mul(0.24),
            );
            graded = graded
                .mul(shadowTint)
                .add(vec3(0.052, 0.021, 0.004).mul(highlight));
        }

        if (this.config.gradeMode === 'full') {
            const edgeOffset = screenUV.sub(0.5);
            const edgeDistanceSquared = dot(edgeOffset, edgeOffset);
            const vignette = smoothstep(0.09, 0.5476, edgeDistanceSquared);
            graded = graded.mul(mix(float(1), float(0.82), vignette));

            const ditherNoise = hash(
                screenUV.x.mul(65535).add(screenUV.y.mul(104729)),
            );
            const dither = ditherNoise.sub(0.5).mul(0.00125);
            graded = graded.add(vec3(dither)).clamp();
        }

        this.postProcessing.outputColorTransform = false;
        this.postProcessing.outputNode = renderOutput(
            vec4(graded, aces.a),
            THREE.NoToneMapping,
        );
        this.postProcessing.needsUpdate = true;
    }

    getDiagnostics() {
        return {
            ...this.config,
            selectiveBloom: this.config.useBloom,
            nonEmissiveBloomRejected: this.config.useBloom,
            toneMapping: 'ACESFilmic',
            outputTransformCount: 1,
            postClass: 'THREE.RenderPipeline',
            disposed: this.disposed,
        };
    }

    getResourceState() {
        return {
            scenePass: this.scenePass,
            postProcessing: this.postProcessing,
            bloomNode: this.bloomNode,
            lutTexture: this.lutTexture,
            lutData: this.lutTexture?.image?.data || null,
            bloomMaterials: this.bloomNode?._separableBlurMaterials?.length ?? 0,
            drawingBuffer: {
                width: this.renderer?.domElement?.width ?? null,
                height: this.renderer?.domElement?.height ?? null,
            },
            disposed: this.disposed,
        };
    }

    setBloomStrength(value) {
        if (this.bloomNode?.strength && Number.isFinite(value)) {
            this.bloomNode.strength.value = Math.max(0, value);
        }
    }

    render() {
        if (this.disposed) return;
        this.postProcessing.render();
    }

    renderAsync() {
        this.render();
        return Promise.resolve();
    }

    /** Session arc scalar in 0..1 from the Offering Loop. */
    setDawn(value) {
        if (this.uDawn) this.uDawn.value = Math.min(1, Math.max(0, Number(value) || 0));
    }

    setSize(width, height) {
        if (
            !Number.isFinite(width)
            || !Number.isFinite(height)
            || width <= 0
            || height <= 0
        ) {
            return;
        }
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    resize(width, height) {
        this.setSize(width, height);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.scenePass?.dispose?.();
        disposeBloomNodeDeep(this.bloomNode);
        if (this.bloomCoreNode) disposeBloomNodeDeep(this.bloomCoreNode);
        this.lutTexture?.dispose?.();
        this.postProcessing?.dispose?.();
        if (this.postProcessing?._quadMesh?.material) {
            this.postProcessing._quadMesh.material.fragmentNode = null;
        }
        if (this.postProcessing) {
            this.postProcessing.outputNode = null;
            this.postProcessing._context = null;
            this.postProcessing.renderer = null;
        }
        if (this.scenePass) {
            this.scenePass.scene = null;
            this.scenePass.camera = null;
            this.scenePass._textures = {};
            this.scenePass._textureNodes = {};
            this.scenePass._linearDepthNodes = {};
            this.scenePass._viewZNodes = {};
            this.scenePass._previousTextures = {};
            this.scenePass._previousTextureNodes = {};
            this.scenePass._mrt = null;
            this.scenePass.renderTarget = null;
        }

        if (this.renderer) {
            this.renderer.toneMapping = this.previousRendererState.toneMapping;
            this.renderer.toneMappingExposure = this.previousRendererState.toneMappingExposure;
        }

        this.scenePass = null;
        this.bloomNode = null;
        this.bloomCoreNode = null;
        this.bloomCombined = null;
        this.lutTexture = null;
        this.postProcessing = null;
    }
}
