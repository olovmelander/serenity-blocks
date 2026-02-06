/**
 * Stellar Drift - Material Factories (Phase 3)
 *
 * Dual-path strategy:
 * - WebGPU: Node materials (TSL) for MRT-ready rendering.
 * - WebGL: Shader/standard material fallbacks for parity and resilience.
 */

import * as THREE from 'three';
import {
    MeshBasicNodeMaterial,
    MeshStandardNodeMaterial,
    PointsNodeMaterial,
} from 'three/webgpu';
import {
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    dot,
    float,
    length,
    max,
    mix,
    normalWorld,
    normalize,
    pointUV,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    storage,
    texture,
    uv,
    uniform,
    vec2,
    vec3,
    vertexIndex,
} from 'three/tsl';

function finalizeStellarMaterial(material, uniforms = {}, meta = {}) {
    const emitsBloom = typeof meta.emitsBloom === 'boolean'
        ? meta.emitsBloom
        : material?.userData?.emitsBloom;

    let zeroEmissiveEnforced = false;
    if (emitsBloom === false) {
        const isNodeMaterial = Boolean(
            material?.isNodeMaterial
            || material?.isMeshBasicNodeMaterial
            || material?.isMeshStandardNodeMaterial
            || material?.isMeshPhysicalNodeMaterial
            || material?.isMeshPhongNodeMaterial
            || material?.isPointsNodeMaterial
            || material?.type?.includes?.('NodeMaterial'),
        );

        if (isNodeMaterial) {
            material.emissiveNode = vec3(0.0);
            zeroEmissiveEnforced = true;
        } else if (material?.emissive?.setRGB) {
            material.emissive.setRGB(0, 0, 0);
            if (typeof material.emissiveIntensity === 'number') {
                material.emissiveIntensity = 0;
            }
            zeroEmissiveEnforced = true;
        }
    }

    material.userData = {
        ...(material.userData || {}),
        uniforms,
        zeroEmissiveEnforced: emitsBloom === false ? zeroEmissiveEnforced : undefined,
        ...meta,
    };
    return { material, uniforms };
}

function resolveColor(color, fallback = 0xffffff) {
    if (color?.isColor) return color.clone();
    return new THREE.Color(color ?? fallback);
}

function createStellarStarfieldNodeMaterial() {
    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
    });

    const uTime = uniform(0);
    const uEventBoost = uniform(0);
    const uWarpSpeed = uniform(0);

    const aColor = attribute('color', 'vec3');
    const aSize = attribute('aSize', 'float');
    const aTwinkle = attribute('aTwinkle', 'vec2');

    const twinkle = sin(uTime.mul(aTwinkle.y).add(aTwinkle.x)).mul(0.2).add(0.8);
    const brightness = twinkle
        .mul(float(1.0).add(uEventBoost.mul(0.3)))
        .mul(float(1.0).add(uWarpSpeed.mul(0.5)));

    const center = pointUV.sub(vec2(0.5, 0.5));
    const dist = length(center);
    const softCircle = smoothstep(float(0.55), float(0.0), dist);

    const coreColor = aColor.mul(brightness).mul(1.8);
    const warpCore = vec3(1.0).mul(uWarpSpeed).mul(softCircle).mul(0.35);

    material.colorNode = coreColor.add(warpCore);
    material.opacityNode = softCircle.mul(brightness.add(0.3));
    material.sizeNode = aSize.mul(float(1.0).add(uWarpSpeed.mul(1.5)));
    material.emissiveNode = vec3(0.0);
    material.userData = {
        ...(material.userData || {}),
        emitsBloom: false,
        mrtRole: 'starfield',
    };

    return finalizeStellarMaterial(
        material,
        {
            uTime,
            uEventBoost,
            uWarpSpeed,
        },
        { emitsBloom: false, mrtRole: 'starfield' },
    );
}

function createStellarStarfieldShaderMaterial({ pixelRatio = 1, starTexture = null } = {}) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: pixelRatio },
            uEventBoost: { value: 0 },
            uTexture: { value: starTexture },
            uWarpSpeed: { value: 0 },
        },
        vertexShader: `
            attribute float aSize;
            attribute vec2 aTwinkle;

            uniform float uTime;
            uniform float uPixelRatio;
            uniform float uEventBoost;
            uniform float uWarpSpeed;

            varying vec3 vColor;
            varying float vBrightness;
            varying float vWarpSpeed;
            varying vec2 vScreenDir;

            void main() {
                vColor = color;
                vWarpSpeed = uWarpSpeed;

                float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
                vBrightness = 0.8 + twinkle * 0.2;
                vBrightness *= (1.0 + uEventBoost * 0.3);
                vBrightness *= (1.0 + uWarpSpeed * 0.5);

                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vec4 projected = projectionMatrix * mvPosition;
                vScreenDir = normalize(projected.xy / projected.w);

                float warpSizeBoost = 1.0 + uWarpSpeed * 1.5;
                gl_PointSize = aSize * uPixelRatio * warpSizeBoost * (400.0 / -mvPosition.z);
                gl_PointSize = clamp(gl_PointSize, 3.0, 120.0);

                gl_Position = projected;
            }
        `,
        fragmentShader: `
            uniform sampler2D uTexture;
            uniform float uWarpSpeed;

            varying vec3 vColor;
            varying float vBrightness;
            varying float vWarpSpeed;
            varying vec2 vScreenDir;

            void main() {
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center) * 2.0;
                float trailFactor = 1.0;

                if (vWarpSpeed > 0.01) {
                    vec2 trailDir = normalize(vScreenDir);
                    float angle = atan(trailDir.y, trailDir.x);

                    float cosA = cos(-angle);
                    float sinA = sin(-angle);
                    vec2 rotatedCenter = vec2(
                        center.x * cosA - center.y * sinA,
                        center.x * sinA + center.y * cosA
                    );

                    float stretch = 1.0 + vWarpSpeed * 4.0;
                    rotatedCenter.x /= stretch;
                    dist = length(rotatedCenter) * 2.0;
                    trailFactor = stretch * 0.5 + 0.5;
                }

                float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);

                vec3 coreColor = vColor * vBrightness * 1.8;
                vec3 trailColor = vColor * (1.0 + vWarpSpeed * 0.5);
                vec3 finalColor = mix(coreColor, trailColor, vWarpSpeed * 0.3);
                finalColor += vec3(1.0) * vWarpSpeed * softCircle * 0.4;

                float alpha = softCircle * (vBrightness + 0.3) * trailFactor;
                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexColors: true,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms,
        { emitsBloom: false, mrtRole: 'starfield' },
    );
}

export function createStellarStarfieldMaterial(params = {}) {
    const isWebGPU = params.isWebGPU === true;
    if (isWebGPU) {
        return createStellarStarfieldNodeMaterial();
    }

    return createStellarStarfieldShaderMaterial({
        pixelRatio: params.pixelRatio ?? 1,
        starTexture: params.starTexture ?? null,
    });
}

function createStellarPlanetNodeMaterial(planetTexture) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uBandIntensity = uniform(0.42);
    const uScatterIntensity = uniform(0.4);
    const uLightningFlash = uniform(0);

    const uvCoord = uv();
    const localPos = positionLocal;
    const radialCoord = length(vec2(localPos.x, localPos.z));
    const nrm = normalWorld;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const lightDir = normalize(vec3(0.7, 0.3, 0.6));

    const texColor = texture(planetTexture, uvCoord).rgb;
    const latBand = sin(
        uvCoord.y.mul(64.0)
            .add(uTime.mul(0.36))
            .add(sin(uvCoord.x.mul(14.0).add(uTime.mul(0.18))).mul(2.8)),
    ).mul(0.5).add(0.5);
    const broadBand = sin(uvCoord.y.mul(22.0).sub(uTime.mul(0.22))).mul(0.5).add(0.5);
    const bandMask = mix(latBand, broadBand, 0.35).mul(uBandIntensity);
    // Natural Jupiter colors: preserve texture, boost contrast
    // Washed out fix: Don't tint with light colors. Instead, slightly boost saturation/contrast.
    const baseColor = texColor.pow(1.2); // Increase contrast (gamma correction-ish)

    const ndotl = dot(nrm, lightDir);
    const shadow = smoothstep(float(-0.1), float(0.3), ndotl);

    // Warmer shadow tones, but deeper to keep contrast
    const shadowColor = baseColor.mul(vec3(0.2, 0.15, 0.1));
    const litColor = mix(shadowColor, baseColor, shadow);

    // Subtle ambient - don't wash out the darks
    const ambientColor = vec3(0.15, 0.1, 0.05);
    const ambient = baseColor.mul(ambientColor).mul(float(1.0).sub(shadow));

    // Subtle warm rim light
    const rimLight = pow(float(1.0).sub(abs(dot(nrm, viewDir))), float(3.0))
        .mul(float(1.0).sub(shadow))
        .mul(0.5);
    const rimColor = vec3(0.95, 0.75, 0.5).mul(rimLight);

    const halfDir = normalize(lightDir.add(viewDir));
    const spec = pow(max(dot(nrm, halfDir), float(0.0)), float(20.0)).mul(shadow).mul(0.12);
    const specColor = vec3(1.0, 0.95, 0.85).mul(spec);

    // Subtle warm atmosphere scatter - less purple, more natural
    const fresnel = pow(float(1.0).sub(abs(dot(nrm, viewDir))), float(2.5));
    const scatter = fresnel.mul(float(0.2).add(uScatterIntensity.mul(0.3)));
    const atmosphereColor = vec3(0.85, 0.65, 0.45).mul(scatter);

    const lightningWave = sin(
        uvCoord.x.mul(48.0)
            .add(uvCoord.y.mul(27.0))
            .add(radialCoord.mul(0.06))
            .add(uTime.mul(8.5)),
    ).mul(0.5).add(0.5);
    const lightningMask = smoothstep(float(0.86), float(0.98), lightningWave);
    const lightningColor = vec3(1.0, 0.94, 0.84).mul(lightningMask).mul(uLightningFlash);

    const pulseMul = float(1.0).add(uPulse.mul(0.15));
    // Preserve natural texture darkness and contrast
    const finalColor = litColor
        .add(ambient)
        .add(rimColor.mul(0.25))
        .add(specColor)
        .add(atmosphereColor.mul(0.3))
        .add(lightningColor)
        .mul(pulseMul)
        .mul(0.48);

    material.colorNode = finalColor;
    // Minimal emissive to avoid bloom washing out the surface
    material.emissiveNode = rimColor.mul(0.1)
        .add(atmosphereColor.mul(0.15))
        .add(lightningColor.mul(1.2));

    return finalizeStellarMaterial(
        material,
        {
            uTime,
            uPulse,
            uBandIntensity,
            uScatterIntensity,
            uLightningFlash,
        },
        { emitsBloom: true, mrtRole: 'planet' },
    );
}

function createStellarPlanetShaderMaterial(planetTexture) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uPulse: { value: 0 },
            uBandIntensity: { value: 0.42 },
            uScatterIntensity: { value: 0.4 },
            uLightningFlash: { value: 0.0 },
            uMap: { value: planetTexture },
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPos;
            
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vLocalPos = position;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uPulse;
            uniform float uBandIntensity;
            uniform float uScatterIntensity;
            uniform float uLightningFlash;
            uniform sampler2D uMap;
            
            varying vec2 vUv;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec3 vLocalPos;

            void main() {
                vec3 viewDir = normalize(vViewPosition);
                
                vec4 texColor = texture2D(uMap, vUv);
                vec3 baseColor = texColor.rgb;
                float radialCoord = length(vec2(vLocalPos.x, vLocalPos.z));

                float latBand = sin(
                    vUv.y * 64.0
                    + uTime * 0.36
                    + sin(vUv.x * 14.0 + uTime * 0.18) * 2.8
                ) * 0.5 + 0.5;
                float broadBand = sin(vUv.y * 22.0 - uTime * 0.22) * 0.5 + 0.5;
                float bandMask = mix(latBand, broadBand, 0.35) * uBandIntensity;
                // Natural Jupiter colors: preserve texture, boost contrast
                // Washed out fix: Don't tint with light colors. Instead, slightly boost saturation/contrast.
                baseColor = pow(baseColor, vec3(1.2)); // Increase contrast (gamma correction-ish)

                vec3 lightDir = normalize(vec3(0.7, 0.3, 0.6));
                float NdotL = dot(vNormal, lightDir);
                float shadow = smoothstep(-0.1, 0.3, NdotL);

                // Warmer shadow tones, but deeper to keep contrast
                vec3 shadowColor = baseColor * vec3(0.2, 0.15, 0.1);
                vec3 litColor = baseColor;
                vec3 finalColor = mix(shadowColor, litColor, shadow);
                
                // Subtle ambient - don't wash out the darks
                vec3 ambientColor = vec3(0.15, 0.1, 0.05);
                finalColor += baseColor * ambientColor * (1.0 - shadow);
                
                // Subtle warm rim light
                float rimLight = pow(1.0 - abs(dot(vNormal, viewDir)), 3.0);
                rimLight *= (1.0 - shadow) * 0.5;
                finalColor += vec3(0.95, 0.75, 0.5) * rimLight * 0.25;
                
                vec3 halfDir = normalize(lightDir + viewDir);
                float spec = pow(max(dot(vNormal, halfDir), 0.0), 20.0) * shadow;
                finalColor += vec3(1.0, 0.95, 0.85) * spec * 0.12;
                
                // Subtle warm atmosphere scatter - less purple, more natural
                float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.5);
                float scatter = fresnel * (0.2 + uScatterIntensity * 0.3);
                vec3 atmosphereColor = vec3(0.85, 0.65, 0.45);
                finalColor += atmosphereColor * scatter * 0.3;

                float lightningWave = sin(
                    vUv.x * 48.0
                    + vUv.y * 27.0
                    + radialCoord * 0.06
                    + uTime * 8.5
                ) * 0.5 + 0.5;
                float lightningMask = smoothstep(0.86, 0.98, lightningWave);
                vec3 lightningColor = vec3(1.0, 0.94, 0.84) * lightningMask * uLightningFlash;
                finalColor += lightningColor;

                // Preserve natural texture darkness and contrast
                finalColor *= (1.0 + uPulse * 0.15) * 0.48;
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms,
        { emitsBloom: true, mrtRole: 'planet' },
    );
}

export function createStellarPlanetMaterial(params = {}) {
    const isWebGPU = params.isWebGPU === true;
    const planetTexture = params.planetTexture || null;
    if (isWebGPU) {
        return createStellarPlanetNodeMaterial(planetTexture);
    }
    return createStellarPlanetShaderMaterial(planetTexture);
}

function createStellarPlanetRingNodeMaterial(params = {}) {
    const colorInner = resolveColor(params.colorInner, 0xe5d8ff);
    const colorOuter = resolveColor(params.colorOuter, 0xa892d9);
    const opacity = Number(params.opacity ?? 0.22);
    const innerRadius = Number(params.innerRadius ?? 600);
    const outerRadius = Number(params.outerRadius ?? 1200);

    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });

    const uColorInner = uniform(colorInner);
    const uColorOuter = uniform(colorOuter);
    const uOpacity = uniform(opacity);
    const uTime = uniform(0);
    const uGlitter = uniform(0);
    const uRingInnerRadius = uniform(innerRadius);
    const uRingOuterRadius = uniform(outerRadius);

    const local = positionLocal;
    const radial = length(vec2(local.x, local.y));
    const radial01 = clamp(
        radial.sub(uRingInnerRadius).div(max(uRingOuterRadius.sub(uRingInnerRadius), float(0.001))),
        float(0.0),
        float(1.0),
    );

    const innerBand = smoothstep(float(0.02), float(0.22), radial01)
        .mul(smoothstep(float(0.56), float(0.34), radial01));
    const outerBand = smoothstep(float(0.62), float(0.72), radial01)
        .mul(smoothstep(float(1.0), float(0.86), radial01));
    const ringMask = innerBand.add(outerBand);

    const angle = atan(local.y, local.x);
    const streak = sin(angle.mul(36.0).add(radial.mul(0.02)).add(uTime.mul(1.8))).mul(0.5).add(0.5);
    const glitterMask = smoothstep(float(0.91), float(0.995), streak);
    const glitter = glitterMask.mul(uGlitter).mul(0.78);

    const baseColor = mix(uColorInner, uColorOuter, radial01).mul(ringMask);
    const finalColor = baseColor.add(vec3(1.0, 0.95, 0.88).mul(glitter));
    const alpha = ringMask.mul(uOpacity).mul(float(0.68).add(glitter.mul(0.82)));

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor.mul(alpha.mul(0.4));

    return finalizeStellarMaterial(
        material,
        {
            uColorInner,
            uColorOuter,
            uOpacity,
            uTime,
            uGlitter,
            uRingInnerRadius,
            uRingOuterRadius,
        },
        { emitsBloom: true, mrtRole: params.mrtRole ?? 'planet-ring' },
    );
}

function createStellarPlanetRingFallbackMaterial(params = {}) {
    const colorInner = resolveColor(params.colorInner, 0xe5d8ff);
    const colorOuter = resolveColor(params.colorOuter, 0xa892d9);
    const opacity = Number(params.opacity ?? 0.22);
    const innerRadius = Number(params.innerRadius ?? 600);
    const outerRadius = Number(params.outerRadius ?? 1200);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uGlitter: { value: 0 },
            uOpacity: { value: opacity },
            uColorInner: { value: colorInner },
            uColorOuter: { value: colorOuter },
            uRingInnerRadius: { value: innerRadius },
            uRingOuterRadius: { value: outerRadius },
        },
        vertexShader: `
            varying vec3 vLocalPos;
            void main() {
                vLocalPos = position;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform float uGlitter;
            uniform float uOpacity;
            uniform vec3 uColorInner;
            uniform vec3 uColorOuter;
            uniform float uRingInnerRadius;
            uniform float uRingOuterRadius;

            varying vec3 vLocalPos;

            void main() {
                float radial = length(vLocalPos.xy);
                float radial01 = clamp(
                    (radial - uRingInnerRadius) / max(uRingOuterRadius - uRingInnerRadius, 0.001),
                    0.0,
                    1.0
                );

                float innerBand = smoothstep(0.02, 0.22, radial01) * smoothstep(0.56, 0.34, radial01);
                float outerBand = smoothstep(0.62, 0.72, radial01) * smoothstep(1.0, 0.86, radial01);
                float ringMask = innerBand + outerBand;

                float angle = atan(vLocalPos.y, vLocalPos.x);
                float streak = sin(angle * 36.0 + radial * 0.02 + uTime * 1.8) * 0.5 + 0.5;
                float glitterMask = smoothstep(0.91, 0.995, streak);
                float glitter = glitterMask * uGlitter * 0.78;

                vec3 baseColor = mix(uColorInner, uColorOuter, radial01) * ringMask;
                vec3 finalColor = baseColor + vec3(1.0, 0.95, 0.88) * glitter;
                float alpha = ringMask * uOpacity * (0.68 + glitter * 0.82);

                gl_FragColor = vec4(finalColor, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms,
        { emitsBloom: true, mrtRole: params.mrtRole ?? 'planet-ring' },
    );
}

export function createStellarPlanetRingMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarPlanetRingNodeMaterial(params);
    }
    return createStellarPlanetRingFallbackMaterial(params);
}

function createStellarGlowPlaneNodeMaterial({ glowTexture, color, opacity }) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uColor = uniform(color.clone ? color.clone() : new THREE.Color(color));
    const uOpacity = uniform(opacity);

    const glowSample = texture(glowTexture, uv());
    const glowColor = glowSample.rgb.mul(uColor);
    const alpha = glowSample.a.mul(uOpacity);

    material.colorNode = glowColor;
    material.opacityNode = alpha;
    material.emissiveNode = glowColor.mul(uOpacity.mul(0.2));

    return finalizeStellarMaterial(
        material,
        { uColor, uOpacity },
        { emitsBloom: true, mrtRole: 'planet-glow' },
    );
}

function createStellarGlowPlaneFallbackMaterial({ glowTexture, color, opacity }) {
    const material = new THREE.MeshBasicMaterial({
        map: glowTexture,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: true, mrtRole: 'planet-glow' },
    );
}

export function createStellarGlowPlaneMaterial(params = {}) {
    const isWebGPU = params.isWebGPU === true;
    if (isWebGPU) {
        return createStellarGlowPlaneNodeMaterial({
            glowTexture: params.glowTexture,
            color: params.color,
            opacity: params.opacity,
        });
    }

    return createStellarGlowPlaneFallbackMaterial({
        glowTexture: params.glowTexture,
        color: params.color,
        opacity: params.opacity,
    });
}

function createStellarNebulaNodeMaterial({ nebulaTexture, opacity }) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    const uTime = uniform(0);
    const uOpacity = uniform(opacity);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const texColor = texture(nebulaTexture, uvCoord);

    const fadeX = smoothstep(float(0.0), float(0.4), uvCoord.x)
        .mul(smoothstep(float(1.0), float(0.6), uvCoord.x));
    const fadeY = smoothstep(float(0.0), float(0.4), uvCoord.y)
        .mul(smoothstep(float(1.0), float(0.6), uvCoord.y));
    const edgeFade = fadeX.mul(fadeY);

    const shimmer = sin(uTime.mul(0.08).add(uvCoord.x.mul(5.0))).mul(0.03).add(0.97);
    const pulseMul = float(1.0).add(uPulse.mul(1.5));

    const nebulaColor = texColor.rgb.mul(pulseMul).mul(shimmer);
    material.colorNode = nebulaColor;
    material.opacityNode = texColor.a.mul(uOpacity.add(uPulse.mul(0.2))).mul(edgeFade);
    material.emissiveNode = nebulaColor.mul(0.1);

    return finalizeStellarMaterial(
        material,
        {
            uTime,
            uOpacity,
            uPulse,
        },
        { emitsBloom: true, mrtRole: 'nebula-backdrop' },
    );
}

function createStellarNebulaShaderMaterial({ nebulaTexture, opacity }) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: nebulaTexture },
            uTime: { value: 0 },
            uOpacity: { value: opacity },
            uPulse: { value: 0.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float uTime;
            uniform float uOpacity;
            uniform float uPulse;

            varying vec2 vUv;

            void main() {
                vec2 uv = vUv;
                vec4 texColor = texture2D(tDiffuse, uv);

                float fadeX = smoothstep(0.0, 0.4, uv.x) * smoothstep(1.0, 0.6, uv.x);
                float fadeY = smoothstep(0.0, 0.4, uv.y) * smoothstep(1.0, 0.6, uv.y);
                float fade = fadeX * fadeY;

                float shimmer = 0.97 + sin(uTime * 0.08 + uv.x * 5.0) * 0.03;
                float pulseAlpha = uPulse * 0.2;
                float alpha = texColor.a * (uOpacity + pulseAlpha) * fade;

                vec3 color = texColor.rgb * (1.0 + uPulse * 1.5) * shimmer;
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms,
        { emitsBloom: false, mrtRole: 'nebula-backdrop' },
    );
}

export function createStellarNebulaMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarNebulaNodeMaterial({
            nebulaTexture: params.nebulaTexture ?? null,
            opacity: params.opacity ?? 0.4,
        });
    }

    return createStellarNebulaShaderMaterial({
        nebulaTexture: params.nebulaTexture ?? null,
        opacity: params.opacity ?? 0.4,
    });
}

function createStellarDustRingNodeMaterial({ size, opacity, dustCompute }) {
    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
    });

    const useCompute = Boolean(
        dustCompute?.getPositionBuffer
        && Number.isFinite(dustCompute?.count),
    );

    const uSize = uniform(size);
    const uOpacity = uniform(opacity);
    const uPulse = uniform(0);

    const aColor = attribute('color', 'vec3');
    const positionStorage = useCompute
        ? storage(dustCompute.getPositionBuffer(), 'vec4', dustCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const particlePosition = useCompute
        ? (positionStorageAttr ? positionStorageAttr.xyz : positionStorage.element(vertexIndex).xyz)
        : null;

    const center = pointUV.sub(vec2(0.5, 0.5));
    const dist = length(center);
    const softCircle = smoothstep(float(0.65), float(0.0), dist);
    const pulseMul = float(1.0).add(uPulse.mul(0.35));

    if (useCompute && particlePosition) {
        material.positionNode = particlePosition;
    }
    material.colorNode = aColor.mul(pulseMul);
    material.opacityNode = softCircle.mul(uOpacity);
    material.sizeNode = uSize.mul(float(1.0).add(uPulse.mul(0.2)));
    material.emissiveNode = vec3(0.0);

    return finalizeStellarMaterial(
        material,
        {
            uSize,
            uOpacity,
            uPulse,
        },
        { emitsBloom: false, mrtRole: 'dust-ring', usesCompute: useCompute },
    );
}

function createStellarDustRingFallbackMaterial({ size, opacity }) {
    const material = new THREE.PointsMaterial({
        size,
        vertexColors: true,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: false, mrtRole: 'dust-ring' },
    );
}

export function createStellarDustRingMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarDustRingNodeMaterial({
            size: params.size ?? 2,
            opacity: params.opacity ?? 0.6,
            dustCompute: params.dustCompute ?? null,
        });
    }

    return createStellarDustRingFallbackMaterial({
        size: params.size ?? 2,
        opacity: params.opacity ?? 0.6,
    });
}

function createStellarAmbientParticlesNodeMaterial({ size, opacity, ambientCompute }) {
    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: true,
    });

    const useCompute = Boolean(
        ambientCompute?.getPositionBuffer
        && ambientCompute?.getMiscBuffer
        && Number.isFinite(ambientCompute?.count),
    );

    const uTime = uniform(0);
    const uSize = uniform(size);
    const uOpacity = uniform(opacity);

    const aColor = attribute('color', 'vec3');
    const aSize = attribute('size', 'float');
    const aPosition = useCompute ? null : attribute('position', 'vec3');
    const positionStorage = useCompute
        ? storage(ambientCompute.getPositionBuffer(), 'vec4', ambientCompute.count)
        : null;
    const miscStorage = useCompute
        ? storage(ambientCompute.getMiscBuffer(), 'vec4', ambientCompute.count)
        : null;
    const positionStorageAttr = useCompute && typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const miscStorageAttr = useCompute && typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    const particlePosition = useCompute
        ? (positionStorageAttr ? positionStorageAttr.xyz : positionStorage.element(vertexIndex).xyz)
        : aPosition;
    const twinkleSeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.x : miscStorage.element(vertexIndex).x)
        : aPosition.x.mul(0.015).add(aPosition.y.mul(0.02));
    const sizeSeed = useCompute
        ? (miscStorageAttr ? miscStorageAttr.y : miscStorage.element(vertexIndex).y)
        : aSize;

    const twinkle = sin(uTime.mul(0.75).add(twinkleSeed))
        .mul(0.15)
        .add(0.85);

    const center = pointUV.sub(vec2(0.5, 0.5));
    const dist = length(center);
    const softCircle = smoothstep(float(0.65), float(0.0), dist);

    if (useCompute && particlePosition) {
        material.positionNode = particlePosition;
    }
    material.colorNode = aColor.mul(twinkle);
    material.opacityNode = softCircle.mul(uOpacity).mul(twinkle.add(0.1));
    material.sizeNode = sizeSeed.mul(uSize);
    material.emissiveNode = vec3(0.0);

    return finalizeStellarMaterial(
        material,
        {
            uTime,
            uSize,
            uOpacity,
        },
        { emitsBloom: false, mrtRole: 'ambient-particles', usesCompute: useCompute },
    );
}

function createStellarAmbientParticlesFallbackMaterial({ size, opacity }) {
    const material = new THREE.PointsMaterial({
        size,
        vertexColors: true,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: false, mrtRole: 'ambient-particles' },
    );
}

export function createStellarAmbientParticlesMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarAmbientParticlesNodeMaterial({
            size: params.size ?? 2,
            opacity: params.opacity ?? 0.6,
            ambientCompute: params.ambientCompute ?? null,
        });
    }

    return createStellarAmbientParticlesFallbackMaterial({
        size: params.size ?? 2,
        opacity: params.opacity ?? 0.6,
    });
}

function createStellarNebulaBurstNodeMaterial({ burstCompute }) {
    const material = new PointsNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
        vertexColors: false,
    });

    const positionStorage = storage(burstCompute.getPositionBuffer(), 'vec4', burstCompute.count);
    const lifeStorage = storage(burstCompute.getLifeBuffer(), 'vec4', burstCompute.count);
    const colorStorage = storage(burstCompute.getColorBuffer(), 'vec4', burstCompute.count);
    const miscStorage = storage(burstCompute.getMiscBuffer(), 'vec4', burstCompute.count);

    const positionStorageAttr = typeof positionStorage.toAttribute === 'function'
        ? positionStorage.toAttribute()
        : null;
    const lifeStorageAttr = typeof lifeStorage.toAttribute === 'function'
        ? lifeStorage.toAttribute()
        : null;
    const colorStorageAttr = typeof colorStorage.toAttribute === 'function'
        ? colorStorage.toAttribute()
        : null;
    const miscStorageAttr = typeof miscStorage.toAttribute === 'function'
        ? miscStorage.toAttribute()
        : null;

    const particlePosition = positionStorageAttr
        ? positionStorageAttr.xyz
        : positionStorage.element(vertexIndex).xyz;
    const particleLife = lifeStorageAttr
        ? lifeStorageAttr.x
        : lifeStorage.element(vertexIndex).x;
    const particleColor = colorStorageAttr
        ? colorStorageAttr.xyz
        : colorStorage.element(vertexIndex).xyz;
    const particleSize = miscStorageAttr
        ? miscStorageAttr.x
        : miscStorage.element(vertexIndex).x;
    const particleActive = miscStorageAttr
        ? miscStorageAttr.y
        : miscStorage.element(vertexIndex).y;

    const center = pointUV.sub(vec2(0.5, 0.5));
    const dist = length(center);
    const softCircle = smoothstep(float(0.65), float(0.0), dist);
    const hidden = vec3(0.0, 0.0, -9999.0);

    material.positionNode = mix(hidden, particlePosition, particleActive);
    material.colorNode = particleColor.mul(float(0.65).add(particleLife.mul(0.35)));
    material.opacityNode = softCircle.mul(particleLife).mul(particleActive);
    material.sizeNode = particleSize.mul(float(0.35).add(particleLife.mul(0.65)));
    material.emissiveNode = particleColor.mul(particleLife.mul(0.45)).mul(particleActive);

    return finalizeStellarMaterial(
        material,
        {},
        { emitsBloom: true, mrtRole: 'nebula-burst', usesCompute: true },
    );
}

function createStellarNebulaBurstFallbackMaterial() {
    const material = new THREE.PointsMaterial({
        size: 220,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: true, mrtRole: 'nebula-burst', usesCompute: false },
    );
}

export function createStellarNebulaBurstMaterial(params = {}) {
    const useCompute = params.isWebGPU === true
        && params.burstCompute?.getPositionBuffer
        && params.burstCompute?.getLifeBuffer
        && params.burstCompute?.getColorBuffer
        && params.burstCompute?.getMiscBuffer;

    if (useCompute) {
        return createStellarNebulaBurstNodeMaterial({
            burstCompute: params.burstCompute,
        });
    }

    return createStellarNebulaBurstFallbackMaterial();
}

function createStellarShockwaveRingNodeMaterial({ color, opacity }) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uColor = uniform(resolveColor(color, 0xffaa66));
    const uOpacity = uniform(opacity);

    material.colorNode = uColor;
    material.opacityNode = uOpacity;
    material.emissiveNode = uColor.mul(uOpacity);

    return finalizeStellarMaterial(
        material,
        { uColor, uOpacity },
        { emitsBloom: true, mrtRole: 'shockwave-ring' },
    );
}

function createStellarShockwaveRingFallbackMaterial({ color, opacity }) {
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: true, mrtRole: 'shockwave-ring' },
    );
}

export function createStellarShockwaveRingMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarShockwaveRingNodeMaterial({
            color: params.color ?? 0xffaa66,
            opacity: params.opacity ?? 0.6,
        });
    }

    return createStellarShockwaveRingFallbackMaterial({
        color: params.color ?? 0xffaa66,
        opacity: params.opacity ?? 0.6,
    });
}

function createStellarShootingStarNodeMaterial({ color, opacity }) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const uColor = uniform(resolveColor(color, 0xffffff));
    const uOpacity = uniform(opacity);

    material.colorNode = uColor;
    material.opacityNode = uOpacity;
    material.emissiveNode = uColor.mul(uOpacity.mul(1.2));

    return finalizeStellarMaterial(
        material,
        { uColor, uOpacity },
        { emitsBloom: true, mrtRole: 'shooting-star' },
    );
}

function createStellarShootingStarFallbackMaterial({ color, opacity }) {
    const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: true, mrtRole: 'shooting-star' },
    );
}

export function createStellarShootingStarMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarShootingStarNodeMaterial({
            color: params.color ?? 0xffffff,
            opacity: params.opacity ?? 1.0,
        });
    }

    return createStellarShootingStarFallbackMaterial({
        color: params.color ?? 0xffffff,
        opacity: params.opacity ?? 1.0,
    });
}

function createStellarCelestialBodyNodeMaterial(params = {}) {
    const colorValue = resolveColor(params.color, 0x7c6e66);
    const emissiveColorValue = resolveColor(params.emissiveColor ?? params.color, 0x7c6e66);
    const emissiveStrength = Number(params.emissiveStrength ?? 0);
    const opacity = Number(params.opacity ?? 1);
    const roughness = Number(params.roughness ?? 0.75);
    const metalness = Number(params.metalness ?? 0.1);

    const material = new MeshStandardNodeMaterial({
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
    });

    const uColor = uniform(colorValue);
    const uEmissiveColor = uniform(emissiveColorValue);
    const uEmissiveStrength = uniform(emissiveStrength);
    const uOpacity = uniform(opacity);

    material.colorNode = uColor;
    material.emissiveNode = uEmissiveColor.mul(uEmissiveStrength);
    if (opacity < 1) {
        material.opacityNode = uOpacity;
    }

    return finalizeStellarMaterial(
        material,
        {
            uColor,
            uEmissiveColor,
            uEmissiveStrength,
            uOpacity,
        },
        {
            emitsBloom: emissiveStrength > 0.001,
            mrtRole: params.mrtRole ?? 'secondary-body',
        },
    );
}

function createStellarCelestialBodyFallbackMaterial(params = {}) {
    const emissiveStrength = Number(params.emissiveStrength ?? 0);
    const opacity = Number(params.opacity ?? 1);
    const roughness = Number(params.roughness ?? 0.75);
    const metalness = Number(params.metalness ?? 0.1);

    const material = new THREE.MeshStandardMaterial({
        color: params.color ?? 0x7c6e66,
        emissive: params.emissiveColor ?? params.color ?? 0x7c6e66,
        emissiveIntensity: emissiveStrength,
        roughness,
        metalness,
        transparent: opacity < 1,
        opacity,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        {
            emitsBloom: emissiveStrength > 0.001,
            mrtRole: params.mrtRole ?? 'secondary-body',
        },
    );
}

export function createStellarCelestialBodyMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarCelestialBodyNodeMaterial(params);
    }
    return createStellarCelestialBodyFallbackMaterial(params);
}

function createStellarMeteorNodeMaterial() {
    const material = new MeshStandardNodeMaterial({
        color: new THREE.Color(0x776655),
        roughness: 0.7,
        metalness: 0.2,
        flatShading: true,
        side: THREE.DoubleSide,
    });

    material.emissiveNode = vec3(0.0);

    return finalizeStellarMaterial(
        material,
        {},
        { emitsBloom: false, mrtRole: 'meteor' },
    );
}

function createStellarMeteorFallbackMaterial() {
    const material = new THREE.MeshStandardMaterial({
        color: 0x776655,
        emissive: 0x222233,
        roughness: 0.7,
        metalness: 0.2,
        flatShading: true,
        side: THREE.DoubleSide,
    });

    return finalizeStellarMaterial(
        material,
        material.uniforms || {},
        { emitsBloom: false, mrtRole: 'meteor' },
    );
}

export function createStellarMeteorMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarMeteorNodeMaterial();
    }

    return createStellarMeteorFallbackMaterial();
}
