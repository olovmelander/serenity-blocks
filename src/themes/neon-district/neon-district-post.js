import * as THREE from 'three/webgpu';
import {
    emissive,
    mrt,
    output,
    pass,
    viewportUV,
    uniform,
    float,
    mix,
    length,
    smoothstep,
    clamp,
    vec2,
    vec3,
    vec4,
    sin,
    max,
    dot,
    fract,
    floor,
    pow,
    step,
    saturation,
    getViewPosition,
    cameraProjectionMatrixInverse,
    cameraWorldMatrix,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { disposeBloomNodeDeep } from '../shared/bloom-dispose.js';
import { withEmissiveMaterialBlending } from '../shared/mrt-blend.js';

export class NeonDistrictPost {
    constructor(renderer, scene, camera, params) {
        this.renderer = renderer;
        this.useMRT = params?.useMRT ?? false;
        this.postProcessing = new THREE.RenderPipeline(renderer);
        this.scenePass = pass(scene, camera);
        if (this.useMRT) {
            this.scenePass.setMRT(withEmissiveMaterialBlending(mrt({ output, emissive })));
        }

        const scenePassColor = this.scenePass.getTextureNode('output');
        const bloomSource = this.useMRT ? this.scenePass.getTextureNode('emissive') : scenePassColor;

        const strength = params?.bloomStrength ?? 1.0;
        const radius = params?.bloomRadius ?? 0.6;
        const threshold = params?.bloomThreshold ?? 0.2;
        this.bloomNode = bloom(bloomSource, strength, radius, threshold);
        this.bloomDownsample = params?.bloomDownsample ?? 0.8;
        const originalBloomSetSize = this.bloomNode.setSize.bind(this.bloomNode);
        this.bloomNode.setSize = (width, height) => {
            originalBloomSetSize(width * this.bloomDownsample, height * this.bloomDownsample);
        };
        this.size = { width: 0, height: 0 };

        this.chromaticAmount = uniform(0.0);
        this.time = uniform(0);
        this.grainAmount = uniform(0.0);

        // ── Atmospheric fog (AAA Phase 2a) ─────────────────────────────────────
        // Two-tone, world-space, height-banded volumetric fog. Denser at street
        // level and with distance; thinner up high so the sky/moon stay readable.
        this.fogColor = uniform(params?.fogColor ?? new THREE.Color(0x1a0b2a));
        this.fogColorFar = uniform(params?.fogColorFar ?? new THREE.Color(0x0a0518));
        this.fogNear = uniform(params?.fogNear ?? 0.18);
        this.fogFar = uniform(params?.fogFar ?? 0.92);
        this.fogDensity = uniform(params?.fogDensity ?? 0.85);
        this.fogBloomAttenuation = uniform(params?.fogBloomAttenuation ?? 0.5);
        this.fogHeightBase = uniform(params?.fogHeightBase ?? 0.0);
        this.fogHeightTop = uniform(params?.fogHeightTop ?? 900.0);
        this.fogHeightFloor = uniform(params?.fogHeightFloor ?? 0.2);

        // ── Volumetric god-rays (AAA Phase 2b) ─────────────────────────────────
        this.enableGodrays = (params?.enableGodrays ?? false) && this.useMRT;
        this.uGodrayIntensity = uniform(params?.godrayIntensity ?? 0.5);
        this.uMoonScreen = uniform(new THREE.Vector2(0.5, 0.55));

        // ── Cinematic post (AAA Phase 3) ───────────────────────────────────────
        // Radial chromatic aberration (3c), far-only DOF bokeh (3a), anamorphic
        // light streaks (3b), film grain (3c) and a procedural filmic grade (3d).
        this.uAberration = uniform(params?.aberration ?? 0.0); // base radial RGB split
        this.uAberrationBoost = uniform(0.0); // transient (combo/glitch)
        this.uGrainIntensity = uniform(params?.grainIntensity ?? 0.0);
        this.enableDOF = params?.enableDOF ?? false;
        this.uDofFocus = uniform(params?.dofFocus ?? 0.32);
        this.uDofRange = uniform(params?.dofRange ?? 2.0);
        this.uDofStrength = uniform(params?.dofStrength ?? 0.85);
        this.uDofMaxRadius = uniform(params?.dofMaxRadius ?? 0.0045);
        this.enableAnamorphic = (params?.enableAnamorphic ?? false) && this.useMRT;
        this.uAnamorphicIntensity = uniform(params?.anamorphicIntensity ?? 0.0);
        this.enableGrade = params?.enableGrade ?? false;
        this.uSaturation = uniform(params?.saturationAmount ?? 1.12);
        this.uContrast = uniform(params?.contrast ?? 1.06);

        // ── 6b. Rain on the lens ───────────────────────────────────────────────
        this.enableLensDroplets = params?.enableLensDroplets ?? false;
        this.uLensDropletAmount = uniform(0.0); // driven by rain intensity each frame
        this.uLensAspect = uniform(16 / 9); // updated in setSize so beads stay round

        const vignetteOffset = float(params?.vignetteOffset ?? 1.0);
        const vignetteDarkness = float(params?.vignetteDarkness ?? 0.3);
        const uv = viewportUV;
        const centered = uv.sub(0.5).mul(2.0);
        const dist = length(centered);
        const vignette = smoothstep(vignetteOffset, vignetteOffset.sub(0.5), dist);

        // Distance/height fog needs the true (undistorted) depth at this pixel.
        const linearDepth = this.scenePass.getLinearDepthNode();

        // ── 3c. Radial chromatic aberration (sharp center, splits toward edges) ──
        const caAmt = this.uAberration.add(this.uAberrationBoost).mul(dist);
        const caOffset = centered.mul(caAmt);
        const caColor = vec4(
            scenePassColor.sample(uv.add(caOffset)).x,
            scenePassColor.sample(uv).y,
            scenePassColor.sample(uv.sub(caOffset)).z,
            float(1.0),
        );

        // ── 3a. Far-only depth-of-field (keeps the hero near-street crisp) ──────
        let baseSample = caColor;
        if (this.enableDOF) {
            const coc = clamp(
                max(float(0.0), linearDepth.sub(this.uDofFocus)).mul(this.uDofRange),
                float(0.0),
                float(1.0),
            ).mul(this.uDofStrength);
            const o = coc.mul(this.uDofMaxRadius);
            const c0 = scenePassColor.sample(uv);
            const c1 = scenePassColor.sample(uv.add(vec2(o, o)));
            const c2 = scenePassColor.sample(uv.add(vec2(o.negate(), o)));
            const c3 = scenePassColor.sample(uv.add(vec2(o, o.negate())));
            const c4 = scenePassColor.sample(uv.add(vec2(o.negate(), o.negate())));
            const dofColor = c0.add(c1).add(c2).add(c3).add(c4)
                .mul(float(0.2));
            baseSample = mix(caColor, dofColor, coc);
        }

        // ── 2a. Reconstruct world position from depth for height-banded fog ─────
        const depthTex = this.scenePass.getTextureNode('depth');
        const rawDepth = depthTex.sample(uv).x;
        const viewPos = getViewPosition(uv, rawDepth, cameraProjectionMatrixInverse);
        const worldPos = cameraWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;

        const distFog = smoothstep(this.fogNear, this.fogFar, linearDepth);
        const heightFalloff = float(1.0).sub(
            smoothstep(this.fogHeightBase, this.fogHeightTop, worldPos.y),
        );
        const heightFog = clamp(heightFalloff, this.fogHeightFloor, float(1.0));
        const fogNoise = sin(worldPos.x.mul(0.004).add(this.time.mul(0.05)))
            .mul(sin(worldPos.z.mul(0.0032).sub(this.time.mul(0.04))))
            .mul(0.14)
            .add(0.9);
        const fogAmount = clamp(
            distFog.mul(heightFog).mul(this.fogDensity).mul(fogNoise),
            0.0,
            1.0,
        );
        const fogTint = mix(this.fogColor, this.fogColorFar, distFog);
        const fogged = mix(baseSample, fogTint, fogAmount);

        const vignetteColor = mix(
            fogged.mul(float(1.0).sub(vignetteDarkness)),
            fogged,
            vignette,
        );

        const bloomAtten = clamp(float(1.0).sub(fogAmount.mul(this.fogBloomAttenuation)), 0.0, 1.0);
        let composited = vignetteColor.add(this.bloomNode.mul(bloomAtten));

        // ── 2b. God-ray shafts (radial march over the emissive buffer) ──────────
        if (this.enableGodrays) {
            const moonUV = clamp(this.uMoonScreen, vec2(0.0, 0.0), vec2(1.0, 1.0));
            const rayDir = moonUV.sub(uv);
            const stepVec = rayDir.mul(float(1.0 / 6.0));
            const sampleRay = (offset, weight) => bloomSource
                .sample(uv.add(stepVec.mul(offset)))
                .xyz
                .mul(weight);
            const rays = sampleRay(float(1.0), float(0.20))
                .add(sampleRay(float(2.0), float(0.17)))
                .add(sampleRay(float(3.0), float(0.14)))
                .add(sampleRay(float(4.0), float(0.11)))
                .add(sampleRay(float(5.0), float(0.08)))
                .add(sampleRay(float(6.0), float(0.06)))
                .mul(this.uGodrayIntensity)
                .mul(max(float(0.0), float(1.0).sub(length(rayDir))));
            composited = composited.add(vec4(rays, 0.0));
        }

        // ── 3b. Anamorphic horizontal light streaks off bright neon ─────────────
        if (this.enableAnamorphic) {
            const streakTap = (dx, weight) => bloomSource
                .sample(uv.add(vec2(float(dx), 0.0)))
                .xyz
                .mul(weight);
            const streak = streakTap(0.006, 0.22)
                .add(streakTap(-0.006, 0.22))
                .add(streakTap(0.014, 0.16))
                .add(streakTap(-0.014, 0.16))
                .add(streakTap(0.026, 0.10))
                .add(streakTap(-0.026, 0.10))
                .mul(vec3(0.8, 0.9, 1.15)) // subtle cool anamorphic tint
                .mul(this.uAnamorphicIntensity);
            composited = composited.add(vec4(streak, 0.0));
        }

        // ── 3d. Procedural filmic grade — teal shadows / magenta highlights ─────
        let gradedRgb = composited.xyz;
        if (this.enableGrade) {
            const luma = dot(gradedRgb, vec3(0.299, 0.587, 0.114));
            const shadowTint = vec3(-0.02, 0.015, 0.04); // cool/teal lift in shadows
            const highlightTint = vec3(0.05, -0.01, 0.04); // magenta in highlights
            const splitToned = gradedRgb
                .add(shadowTint.mul(float(1.0).sub(luma)))
                .add(highlightTint.mul(luma));
            const contrasted = splitToned.sub(0.5).mul(this.uContrast).add(0.5);
            gradedRgb = saturation(contrasted, this.uSaturation);
        }

        // ── 6b. Rain droplets clinging to the camera lens ───────────────────────
        // Sparse aspect-corrected beads that slowly fade in/out, gently magnify the
        // scene behind them and catch a specular sparkle off the neon.
        if (this.enableLensDroplets) {
            const hash2 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
            const cols = float(9.0).mul(this.uLensAspect); // square cells → round beads
            const su = vec2(uv.x.mul(cols), uv.y.mul(9.0));
            const cell = floor(su);
            const f = fract(su).sub(0.5);
            const r1 = hash2(cell);
            const r2 = hash2(cell.add(vec2(19.3, 7.1)));
            const r3 = hash2(cell.add(vec2(3.7, 41.2)));
            const cyc = fract(r3.add(this.time.mul(0.05).mul(r2.add(0.3))));
            const life = sin(cyc.mul(3.14159));
            // Sparse: only ~14% of cells hold a bead, so it reads as occasional rain
            // beads rather than a lens caked in bubbles.
            const beadAmt = step(0.86, r1).mul(life).mul(this.uLensDropletAmount);
            const center = vec2(r1.sub(0.5), r2.sub(0.5)).mul(0.5);
            const fd = f.sub(center);
            const d = length(fd);
            const radius = mix(float(0.09), float(0.22), r2);
            const beadMask = smoothstep(radius, radius.mul(0.5), d).mul(beadAmt);

            // Magnify-refraction of the scene behind the bead.
            const fdUv = vec2(fd.x.div(cols), fd.y.div(9.0));
            const refractUv = uv.sub(fdUv.mul(float(2.0)).mul(beadMask));
            const refracted = scenePassColor.sample(refractUv).xyz;
            let withDrops = mix(gradedRgb, refracted, beadMask.mul(0.65));

            // Specular sparkle (toward a fixed light dir) + a faint cool rim — bright
            // enough that the beads read as water catching light, not dark spots.
            const specD = length(fd.sub(vec2(-0.06, 0.08)));
            const spec = pow(smoothstep(radius.mul(0.6), 0.0, specD), float(2.0)).mul(beadMask);
            const rim = smoothstep(radius, radius.mul(0.82), d)
                .mul(smoothstep(radius.mul(0.55), radius, d))
                .mul(beadMask);
            withDrops = withDrops.add(vec3(spec.mul(0.7)));
            withDrops = withDrops.add(vec3(0.45, 0.6, 0.9).mul(rim.mul(0.32)));
            gradedRgb = withDrops;
        }

        // ── 3c. Film grain (animated) ───────────────────────────────────────────
        const grainNoise = fract(
            sin(dot(uv.mul(900.0).add(this.time.mul(1.7)), vec2(12.9898, 78.233))).mul(43758.5453),
        ).sub(0.5);
        gradedRgb = gradedRgb.add(grainNoise.mul(this.uGrainIntensity));

        this.postProcessing.outputNode = vec4(gradedRgb, composited.w);
        this.postProcessing.needsUpdate = true;
    }

    updateParams(params) {
        if (params?.bloomStrength !== undefined) {
            this.bloomNode.strength.value = params.bloomStrength;
        }
        if (params?.bloomRadius !== undefined) {
            this.bloomNode.radius.value = params.bloomRadius;
        }
        if (params?.bloomThreshold !== undefined) {
            this.bloomNode.threshold.value = params.bloomThreshold;
        }
        if (params?.bloomDownsample !== undefined) {
            this.bloomDownsample = params.bloomDownsample;
            if (this.size.width && this.size.height && this.bloomNode?._separableBlurMaterials?.length) {
                this.bloomNode.setSize(this.size.width, this.size.height);
            }
        }
        if (params?.fogColor !== undefined && this.fogColor) {
            this.fogColor.value = params.fogColor;
        }
        if (params?.fogColorFar !== undefined && this.fogColorFar) {
            this.fogColorFar.value = params.fogColorFar;
        }
        if (params?.fogNear !== undefined && this.fogNear) {
            this.fogNear.value = params.fogNear;
        }
        if (params?.fogFar !== undefined && this.fogFar) {
            this.fogFar.value = params.fogFar;
        }
        if (params?.fogDensity !== undefined && this.fogDensity) {
            this.fogDensity.value = params.fogDensity;
        }
        if (params?.fogBloomAttenuation !== undefined && this.fogBloomAttenuation) {
            this.fogBloomAttenuation.value = params.fogBloomAttenuation;
        }
        if (params?.godrayIntensity !== undefined && this.uGodrayIntensity) {
            this.uGodrayIntensity.value = params.godrayIntensity;
        }
        if (params?.aberration !== undefined && this.uAberration) {
            this.uAberration.value = params.aberration;
        }
        if (params?.grainIntensity !== undefined && this.uGrainIntensity) {
            this.uGrainIntensity.value = params.grainIntensity;
        }
        if (params?.saturationAmount !== undefined && this.uSaturation) {
            this.uSaturation.value = params.saturationAmount;
        }
        if (params?.contrast !== undefined && this.uContrast) {
            this.uContrast.value = params.contrast;
        }
    }

    updateTime(time) {
        if (this.time) {
            this.time.value = time;
        }
    }

    /** AAA 6b — set the rain-on-lens droplet amount (0 = none). */
    setLensDroplets(amount) {
        if (this.uLensDropletAmount) {
            this.uLensDropletAmount.value = amount;
        }
    }

    /**
     * AAA Phase 2b — update the god-ray anchor (screen-space UV of the moon) and
     * optionally its intensity. Call each frame after projecting the moon to NDC.
     */
    updateGodrays(screenUV, intensity) {
        if (screenUV && this.uMoonScreen) {
            this.uMoonScreen.value.copy(screenUV);
        }
        if (intensity !== undefined && this.uGodrayIntensity) {
            this.uGodrayIntensity.value = intensity;
        }
    }

    /**
     * AAA Phase 3c — transient chromatic-aberration boost for combo/glitch events.
     * @param {number} amount - extra radial CA on top of the base amount.
     */
    setAberrationBoost(amount) {
        if (this.uAberrationBoost) {
            this.uAberrationBoost.value = amount;
        }
    }

    render() {
        this.postProcessing.render();
    }

    setSize(width, height) {
        this.size.width = width;
        this.size.height = height;
        this.scenePass.setSize(width, height);
        if (this.uLensAspect && height > 0) {
            this.uLensAspect.value = width / height; // keep lens beads round
        }
        if (this.bloomNode?._separableBlurMaterials?.length) {
            this.bloomNode.setSize(width, height);
        }
    }

    dispose() {
        this.scenePass.dispose();
        disposeBloomNodeDeep(this.bloomNode);
        this.postProcessing.dispose();
    }
}
