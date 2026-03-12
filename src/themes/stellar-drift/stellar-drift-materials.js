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
    Fn,
    abs,
    atan,
    attribute,
    cameraPosition,
    clamp,
    fract,
    dot,
    float,
    floor,
    length,
    max,
    mix,
    normalWorld,
    normalize,
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

const nebulaNoiseGLSL = `
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);

    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));

    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x)
        + (c - a) * u.y * (1.0 - u.x)
        + (d - b) * u.x * u.y;
}

float fbm2(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += noise2(p) * amplitude;
        p = p * 2.02 + vec2(17.13, 9.71);
        amplitude *= 0.5;
    }
    return value;
}
`;

const bloodMoonNebulaNoiseGLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * snoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}
`;

const NEBULA_VARIANT_DEFAULTS = {
    hero: {
        opacity: 0.22,
        flowStrength: 0.065,
        detailStrength: 1.18,
        densityThreshold: 0.42,
        emissiveGain: 0.12,
        edgeSoftness: 0.84,
        driftAngle: 0.24,
        driftSkew: 0.42,
        pulseResponse: 1.0,
        highlightStrength: 1.0,
        colorInfluence: 0.2,
        alphaGain: 1.0,
        densityPower: 1.2,
    },
    support: {
        opacity: 0.16,
        flowStrength: 0.046,
        detailStrength: 0.96,
        densityThreshold: 0.38,
        emissiveGain: 0.07,
        edgeSoftness: 1.02,
        driftAngle: 1.12,
        driftSkew: 0.34,
        pulseResponse: 0.58,
        highlightStrength: 0.72,
        colorInfluence: 0.16,
        alphaGain: 0.82,
        densityPower: 1.34,
    },
    haze: {
        opacity: 0.09,
        flowStrength: 0.028,
        detailStrength: 0.78,
        densityThreshold: 0.48,
        emissiveGain: 0.028,
        edgeSoftness: 1.36,
        driftAngle: -0.44,
        driftSkew: 0.22,
        pulseResponse: 0.28,
        highlightStrength: 0.34,
        colorInfluence: 0.1,
        alphaGain: 0.64,
        densityPower: 1.56,
    },
};

function getNebulaVariantDefaults(variant = 'hero') {
    if (variant === 'backdrop') return NEBULA_VARIANT_DEFAULTS.hero;
    return NEBULA_VARIANT_DEFAULTS[variant] || NEBULA_VARIANT_DEFAULTS.hero;
}

function resolveNebulaDriftDirection(params, defaults, phaseSeed) {
    if (params.driftDirection?.isVector2) {
        const explicitDirection = params.driftDirection.clone();
        if (explicitDirection.lengthSq() > 0.0001) {
            explicitDirection.normalize();
            return explicitDirection;
        }
    }

    const angle = (phaseSeed * 0.173) + defaults.driftAngle;
    const direction = new THREE.Vector2(
        Math.cos(angle),
        Math.sin(angle) * (defaults.driftSkew ?? 0.35),
    );

    if (direction.lengthSq() <= 0.0001) {
        return new THREE.Vector2(1, 0);
    }

    return direction.normalize();
}

function createNebulaMaterialConfig(params = {}) {
    const variant = params.variant ?? 'hero';
    const defaults = getNebulaVariantDefaults(variant);
    const phaseSeed = Number(params.phaseSeed ?? 0);

    return {
        variant,
        opacity: Number(params.opacity ?? defaults.opacity),
        tintColor: resolveColor(params.tintColor, 0xffffff),
        flowStrength: Number(params.flowStrength ?? defaults.flowStrength),
        detailStrength: Number(params.detailStrength ?? params.detailScale ?? defaults.detailStrength),
        densityThreshold: Number(params.densityThreshold ?? defaults.densityThreshold),
        emissiveGain: Number(params.emissiveGain ?? defaults.emissiveGain),
        edgeSoftness: Number(params.edgeSoftness ?? defaults.edgeSoftness),
        driftDirection: resolveNebulaDriftDirection(params, defaults, phaseSeed),
        phaseSeed,
        profile: {
            pulseResponse: defaults.pulseResponse,
            highlightStrength: defaults.highlightStrength,
            colorInfluence: defaults.colorInfluence,
            alphaGain: defaults.alphaGain,
            densityPower: defaults.densityPower,
        },
    };
}

function nebulaHashNode(p, seed) {
    const uvDotA = dot(p, vec2(127.1, 311.7));
    const uvDotB = dot(p, vec2(269.5, 183.3));
    const noiseA = fract(sin(uvDotA.add(seed.mul(17.17))).mul(43758.5453));
    const noiseB = fract(sin(uvDotB.sub(seed.mul(11.31))).mul(24634.6345));
    return noiseA.mul(0.62).add(noiseB.mul(0.38));
}

function nebulaFbmNode(p, seed) {
    const octave1 = nebulaHashNode(p, seed);
    const octave2 = nebulaHashNode(
        p.mul(1.93).add(vec2(4.31, 2.17)),
        seed.add(5.17),
    ).mul(0.52);
    const octave3 = nebulaHashNode(
        p.mul(3.71).sub(vec2(7.91, 5.23)),
        seed.add(10.73),
    ).mul(0.27);
    const octave4 = nebulaHashNode(
        p.mul(6.22).add(vec2(11.6, 8.4)),
        seed.add(16.91),
    ).mul(0.15);

    return octave1.mul(0.5).add(octave2).add(octave3).add(octave4);
}

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

function resolveStellarBloodMoonPalette(palette = {}) {
    return {
        shadow: resolveColor(palette.shadow, 0x3b1f00),
        body: resolveColor(palette.body, 0xd99c1e),
        glow: resolveColor(palette.glow, 0xf8f2c9),
    };
}

const bloodMoonHash3DNode = /* @__PURE__ */ Fn(([p]) => (
    fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453))
));

const bloodMoonNoise3DNode = /* @__PURE__ */ Fn(([p]) => {
    const i = floor(p);
    const f = fract(p);
    const u = f.mul(f).mul(vec3(3.0).sub(f.mul(2.0)));

    const a = bloodMoonHash3DNode(i);
    const b = bloodMoonHash3DNode(i.add(vec3(1.0, 0.0, 0.0)));
    const c = bloodMoonHash3DNode(i.add(vec3(0.0, 1.0, 0.0)));
    const d = bloodMoonHash3DNode(i.add(vec3(1.0, 1.0, 0.0)));
    const e = bloodMoonHash3DNode(i.add(vec3(0.0, 0.0, 1.0)));
    const f1 = bloodMoonHash3DNode(i.add(vec3(1.0, 0.0, 1.0)));
    const g = bloodMoonHash3DNode(i.add(vec3(0.0, 1.0, 1.0)));
    const h = bloodMoonHash3DNode(i.add(vec3(1.0, 1.0, 1.0)));

    const x1 = mix(a, b, u.x);
    const x2 = mix(c, d, u.x);
    const y1 = mix(x1, x2, u.y);
    const x3 = mix(e, f1, u.x);
    const x4 = mix(g, h, u.x);
    const y2 = mix(x3, x4, u.y);

    return mix(y1, y2, u.z).mul(2.0).sub(1.0);
});

const bloodMoonFbm3DNode = /* @__PURE__ */ Fn(([p]) => {
    const octave1 = bloodMoonNoise3DNode(p).mul(0.5);
    const octave2 = bloodMoonNoise3DNode(p.mul(2.0)).mul(0.25);
    const octave3 = bloodMoonNoise3DNode(p.mul(4.0)).mul(0.125);
    const octave4 = bloodMoonNoise3DNode(p.mul(8.0)).mul(0.0625);
    const octave5 = bloodMoonNoise3DNode(p.mul(16.0)).mul(0.03125);

    return octave1.add(octave2).add(octave3).add(octave4).add(octave5);
});

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

    const center = uv().sub(vec2(0.5, 0.5));
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

function createStellarBloodMoonNebulaNodeMaterial(params = {}) {
    const palette = resolveStellarBloodMoonPalette(params.palette);
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    const uTime = uniform(0);
    const uOpacity = uniform(Number(params.opacity ?? 0.3));
    const uPulse = uniform(0);
    const uColorShadow = uniform(palette.shadow);
    const uColorBody = uniform(palette.body);
    const uColorGlow = uniform(palette.glow);

    const uvCoord = uv();
    const timePhase = uTime.mul(0.05);
    const distortX = bloodMoonFbm3DNode(vec3(uvCoord.mul(2.0), timePhase)).mul(0.1);
    const distortY = bloodMoonFbm3DNode(vec3(uvCoord.mul(2.0).add(vec2(10.0, 10.0)), timePhase)).mul(0.1);
    const distortedUv = uvCoord.add(vec2(distortX, distortY));
    const texColor = texture(params.nebulaTexture, distortedUv);

    const fadeX = smoothstep(float(0.0), float(0.4), distortedUv.x)
        .mul(smoothstep(float(1.0), float(0.6), distortedUv.x));
    const fadeY = smoothstep(float(0.0), float(0.4), distortedUv.y)
        .mul(smoothstep(float(1.0), float(0.6), distortedUv.y));
    const fade = pow(clamp(fadeX.mul(fadeY), float(0.0), float(1.0)), float(1.5));
    const alpha = texColor.a.mul(uOpacity.add(uPulse.mul(0.1))).mul(fade);

    const luminance = dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    const rampInput = clamp(texColor.r.mul(0.8).add(luminance.mul(0.2)), float(0.0), float(1.0));
    const bodyBlend = smoothstep(float(0.08), float(0.58), rampInput);
    const glowBlend = smoothstep(float(0.52), float(0.95), rampInput);
    const densityLift = float(0.78).add(rampInput.mul(0.42));
    const recolored = mix(
        mix(uColorShadow, uColorBody, bodyBlend),
        uColorGlow,
        glowBlend,
    ).mul(densityLift);

    const volHi = smoothstep(float(0.0), float(0.05), distortX).mul(0.5).mul(texColor.r);
    const highlightColor = mix(uColorBody, uColorGlow, float(0.72)).mul(volHi.mul(1.2));
    const finalColor = recolored.mul(float(1.0).add(uPulse.mul(0.3))).add(highlightColor);
    const emissiveMask = smoothstep(float(0.16), float(0.82), rampInput).mul(alpha);

    material.colorNode = finalColor;
    material.opacityNode = clamp(alpha, float(0.0), float(1.0));
    material.emissiveNode = finalColor.mul(emissiveMask);

    return finalizeStellarMaterial(
        material,
        {
            tDiffuse: params.nebulaTexture,
            uOpacity,
            uPulse,
            uTime,
            uColorShadow,
            uColorBody,
            uColorGlow,
        },
        { emitsBloom: true, mrtRole: 'nebula-bloodmoon-backdrop' },
    );
}

function createStellarBloodMoonNebulaShaderMaterial(params = {}) {
    const palette = resolveStellarBloodMoonPalette(params.palette);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: params.nebulaTexture },
            uOpacity: { value: Number(params.opacity ?? 0.3) },
            uPulse: { value: 0.0 },
            uTime: { value: 0.0 },
            uColorShadow: { value: palette.shadow },
            uColorBody: { value: palette.body },
            uColorGlow: { value: palette.glow },
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
            uniform float uOpacity;
            uniform float uPulse;
            uniform float uTime;
            uniform vec3 uColorShadow;
            uniform vec3 uColorBody;
            uniform vec3 uColorGlow;

            varying vec2 vUv;

            ${bloodMoonNebulaNoiseGLSL}

            void main() {
                float distortX = fbm(vec3(vUv * 2.0, uTime * 0.05)) * 0.1;
                float distortY = fbm(vec3(vUv * 2.0 + 10.0, uTime * 0.05)) * 0.1;
                vec2 distortedUv = vUv + vec2(distortX, distortY);

                vec4 texColor = texture2D(tDiffuse, distortedUv);

                float fadeX = smoothstep(0.0, 0.4, distortedUv.x) * smoothstep(1.0, 0.6, distortedUv.x);
                float fadeY = smoothstep(0.0, 0.4, distortedUv.y) * smoothstep(1.0, 0.6, distortedUv.y);
                float fade = pow(clamp(fadeX * fadeY, 0.0, 1.0), 1.5);
                float alpha = texColor.a * (uOpacity + uPulse * 0.1) * fade;

                float luminance = dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722));
                float rampInput = clamp(texColor.r * 0.8 + luminance * 0.2, 0.0, 1.0);
                float bodyBlend = smoothstep(0.08, 0.58, rampInput);
                float glowBlend = smoothstep(0.52, 0.95, rampInput);
                float densityLift = 0.78 + rampInput * 0.42;
                vec3 recolored = mix(
                    mix(uColorShadow, uColorBody, bodyBlend),
                    uColorGlow,
                    glowBlend
                ) * densityLift;

                float volHi = smoothstep(0.0, 0.05, distortX) * 0.5 * texColor.r;
                vec3 highlightColor = mix(uColorBody, uColorGlow, 0.72) * (volHi * 1.2);
                vec3 color = recolored * (1.0 + uPulse * 0.3) + highlightColor;

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
        { emitsBloom: true, mrtRole: 'nebula-bloodmoon-backdrop' },
    );
}

export function createStellarBloodMoonNebulaMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarBloodMoonNebulaNodeMaterial(params);
    }

    return createStellarBloodMoonNebulaShaderMaterial(params);
}

function createStellarNebulaNodeMaterial(params = {}) {
    const config = createNebulaMaterialConfig(params);
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
    });

    const uTime = uniform(0);
    const uOpacity = uniform(config.opacity);
    const uPulse = uniform(0);
    const uTintColor = uniform(config.tintColor);
    const uFlowStrength = uniform(config.flowStrength);
    const uDetailStrength = uniform(config.detailStrength);
    const uDensityThreshold = uniform(config.densityThreshold);
    const uEmissiveGain = uniform(config.emissiveGain);
    const uEdgeSoftness = uniform(config.edgeSoftness);
    const uDriftDirection = uniform(config.driftDirection);
    const uPhaseSeed = uniform(config.phaseSeed);

    const uvCoord = uv();
    const timePhase = uTime.mul(0.05).add(uPhaseSeed);
    const detailUv = uvCoord.mul(float(0.92).add(uDetailStrength.mul(0.42)));
    const drift = uDriftDirection.mul(uTime.mul(0.0075));

    const lowFlow = nebulaFbmNode(
        detailUv.mul(0.95).add(drift.mul(0.35)).add(vec2(timePhase.mul(0.08), timePhase.mul(-0.05))),
        uPhaseSeed,
    );
    const curlA = nebulaFbmNode(
        detailUv.mul(1.75).sub(drift.mul(0.8)).add(vec2(timePhase.mul(-0.14), timePhase.mul(0.11))),
        uPhaseSeed.add(7.13),
    );
    const curlB = nebulaFbmNode(
        detailUv.mul(1.42).add(drift.mul(0.55)).add(vec2(timePhase.mul(0.12), timePhase.mul(0.09))),
        uPhaseSeed.add(14.71),
    );

    const flowVector = vec2(lowFlow.sub(0.5), curlA.sub(0.5))
        .mul(uFlowStrength.mul(float(0.7).add(uDetailStrength.mul(0.18))));
    const curlVector = vec2(curlA.sub(curlB), lowFlow.sub(curlB))
        .mul(uFlowStrength.mul(0.32));

    const primarySample = texture(
        params.nebulaTexture,
        uvCoord.add(flowVector).add(drift.mul(0.16)),
    );
    const detailSample = texture(
        params.nebulaTexture,
        uvCoord.add(flowVector.mul(0.42)).sub(curlVector).sub(drift.mul(0.08)),
    );

    const rawDensity = max(primarySample.a.mul(0.96), detailSample.a.mul(0.84));
    const densityField = rawDensity.add(lowFlow.mul(0.1)).sub(curlB.mul(0.06));
    const densityMask = smoothstep(
        uDensityThreshold.sub(float(0.16)),
        uDensityThreshold.add(float(0.14)),
        densityField,
    );
    const density = pow(
        clamp(densityMask, float(0.0), float(1.0)),
        float(config.profile.densityPower),
    );
    const densityGradient = clamp(
        detailSample.a
            .sub(primarySample.a.mul(0.74))
            .add(curlA.mul(0.18))
            .sub(curlB.mul(0.08)),
        float(0.0),
        float(1.0),
    );
    const filamentMask = smoothstep(float(0.16), float(0.56), densityGradient);
    const rimMask = smoothstep(
        float(0.22),
        float(0.72),
        density.sub(detailSample.a.mul(0.35)).add(lowFlow.mul(0.12)),
    );

    const edgeReach = float(0.16).add(uEdgeSoftness.mul(0.07));
    const fadeX = smoothstep(float(0.0), edgeReach, uvCoord.x)
        .mul(smoothstep(float(1.0), float(1.0).sub(edgeReach), uvCoord.x));
    const fadeY = smoothstep(float(0.0), edgeReach, uvCoord.y)
        .mul(smoothstep(float(1.0), float(1.0).sub(edgeReach), uvCoord.y));
    const edgeFade = pow(
        clamp(fadeX.mul(fadeY), float(0.0), float(1.0)),
        float(1.25).div(clamp(uEdgeSoftness, float(0.6), float(1.6))),
    );

    const primaryTintMix = float(config.profile.colorInfluence);
    const detailTintMix = float(Math.min(0.92, config.profile.colorInfluence + 0.08));
    const highlightStrength = float(config.profile.highlightStrength);
    const pulseResponse = float(config.profile.pulseResponse);
    const alphaGain = float(config.profile.alphaGain);
    const pulseEnvelope = float(1.0).add(uPulse.mul(pulseResponse.mul(0.12)));

    const bodyColor = mix(primarySample.rgb, uTintColor, primaryTintMix);
    const detailColor = mix(detailSample.rgb, uTintColor, detailTintMix);
    const highlight = uTintColor.mul(
        filamentMask.mul(highlightStrength.mul(0.16))
            .add(rimMask.mul(highlightStrength.mul(0.2))),
    );
    const nebulaColor = bodyColor.mul(float(0.42).add(density.mul(0.86)))
        .add(detailColor.mul(filamentMask.mul(0.16)))
        .add(highlight)
        .mul(pulseEnvelope)
        .mul(float(0.86).add(lowFlow.mul(0.1)));
    const alpha = density
        .mul(edgeFade)
        .mul(uOpacity)
        .mul(alphaGain)
        .mul(float(0.82).add(filamentMask.mul(0.18)))
        .mul(float(1.0).add(uPulse.mul(pulseResponse.mul(0.06))));
    const emissiveMask = density
        .mul(density)
        .mul(float(0.18).add(filamentMask.mul(0.66)).add(rimMask.mul(0.42)));
    const emissive = uTintColor.mul(emissiveMask)
        .mul(uEmissiveGain)
        .mul(highlightStrength)
        .mul(float(0.68).add(uPulse.mul(pulseResponse.mul(0.12))));

    material.colorNode = nebulaColor;
    material.opacityNode = clamp(alpha, float(0.0), float(1.0));
    material.emissiveNode = emissive;

    return finalizeStellarMaterial(
        material,
        {
            uTime,
            uOpacity,
            uPulse,
            uTintColor,
            uFlowStrength,
            uDetailStrength,
            uDensityThreshold,
            uEmissiveGain,
            uEdgeSoftness,
            uDriftDirection,
            uPhaseSeed,
        },
        { emitsBloom: true, mrtRole: 'nebula-backdrop' },
    );
}

function createStellarNebulaShaderMaterial(params = {}) {
    const config = createNebulaMaterialConfig(params);
    const material = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: params.nebulaTexture },
            uTime: { value: 0 },
            uOpacity: { value: config.opacity },
            uPulse: { value: 0.0 },
            uTintColor: { value: config.tintColor },
            uFlowStrength: { value: config.flowStrength },
            uDetailStrength: { value: config.detailStrength },
            uDensityThreshold: { value: config.densityThreshold },
            uEmissiveGain: { value: config.emissiveGain },
            uEdgeSoftness: { value: config.edgeSoftness },
            uDriftDirection: { value: config.driftDirection },
            uPhaseSeed: { value: config.phaseSeed },
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
            uniform vec3 uTintColor;
            uniform float uFlowStrength;
            uniform float uDetailStrength;
            uniform float uDensityThreshold;
            uniform float uEmissiveGain;
            uniform float uEdgeSoftness;
            uniform vec2 uDriftDirection;
            uniform float uPhaseSeed;

            varying vec2 vUv;

            ${nebulaNoiseGLSL}

            void main() {
                vec2 uv = vUv;
                float timePhase = uTime * 0.05 + uPhaseSeed;
                vec2 detailUv = uv * (0.92 + uDetailStrength * 0.42);
                vec2 drift = uDriftDirection * (uTime * 0.0075);

                float lowFlow = fbm2(detailUv * 0.95 + drift * 0.35 + vec2(timePhase * 0.08, -timePhase * 0.05));
                float curlA = fbm2(detailUv * 1.75 - drift * 0.8 + vec2(-timePhase * 0.14, timePhase * 0.11));
                float curlB = fbm2(detailUv * 1.42 + drift * 0.55 + vec2(timePhase * 0.12, timePhase * 0.09));

                vec2 flowVec = vec2(lowFlow - 0.5, curlA - 0.5) * (uFlowStrength * (0.7 + uDetailStrength * 0.18));
                vec2 curlVec = vec2(curlA - curlB, lowFlow - curlB) * (uFlowStrength * 0.32);

                vec4 primarySample = texture2D(tDiffuse, uv + flowVec + drift * 0.16);
                vec4 detailSample = texture2D(tDiffuse, uv + flowVec * 0.42 - curlVec - drift * 0.08);

                float rawDensity = max(primarySample.a * 0.96, detailSample.a * 0.84);
                float densityField = rawDensity + lowFlow * 0.1 - curlB * 0.06;
                float density = smoothstep(uDensityThreshold - 0.16, uDensityThreshold + 0.14, densityField);
                density = pow(clamp(density, 0.0, 1.0), ${config.profile.densityPower.toFixed(2)});

                float densityGradient = clamp(
                    detailSample.a - primarySample.a * 0.74 + curlA * 0.18 - curlB * 0.08,
                    0.0,
                    1.0
                );
                float filamentMask = smoothstep(0.16, 0.56, densityGradient);
                float rimMask = smoothstep(0.22, 0.72, density - detailSample.a * 0.35 + lowFlow * 0.12);

                float edgeReach = 0.16 + uEdgeSoftness * 0.07;
                float fadeX = smoothstep(0.0, edgeReach, uv.x) * smoothstep(1.0, 1.0 - edgeReach, uv.x);
                float fadeY = smoothstep(0.0, edgeReach, uv.y) * smoothstep(1.0, 1.0 - edgeReach, uv.y);
                float edgeFade = pow(clamp(fadeX * fadeY, 0.0, 1.0), 1.25 / clamp(uEdgeSoftness, 0.6, 1.6));

                float pulseEnvelope = 1.0 + uPulse * ${(
        config.profile.pulseResponse * 0.12
    ).toFixed(3)};
                vec3 bodyColor = mix(primarySample.rgb, uTintColor, ${config.profile.colorInfluence.toFixed(3)});
                vec3 detailColor = mix(detailSample.rgb, uTintColor, ${Math.min(
        0.92,
        config.profile.colorInfluence + 0.08,
    ).toFixed(3)});
                vec3 highlight = uTintColor * (
                    filamentMask * ${(
        config.profile.highlightStrength * 0.16
    ).toFixed(3)}
                    + rimMask * ${(
        config.profile.highlightStrength * 0.2
    ).toFixed(3)}
                );

                vec3 color = (
                    bodyColor * (0.42 + density * 0.86)
                    + detailColor * (filamentMask * 0.16)
                    + highlight
                ) * pulseEnvelope * (0.86 + lowFlow * 0.1);

                float alpha = density
                    * edgeFade
                    * uOpacity
                    * ${config.profile.alphaGain.toFixed(3)}
                    * (0.82 + filamentMask * 0.18)
                    * (1.0 + uPulse * ${(
        config.profile.pulseResponse * 0.06
    ).toFixed(3)});

                float emissiveMask = density * density * (0.18 + filamentMask * 0.66 + rimMask * 0.42);
                vec3 emissiveColor = uTintColor
                    * emissiveMask
                    * uEmissiveGain
                    * ${config.profile.highlightStrength.toFixed(3)}
                    * (0.68 + uPulse * ${(
        config.profile.pulseResponse * 0.12
    ).toFixed(3)});

                gl_FragColor = vec4(color + emissiveColor, clamp(alpha, 0.0, 1.0));
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
        { emitsBloom: true, mrtRole: 'nebula-backdrop' },
    );
}

export function createStellarNebulaMaterial(params = {}) {
    if (params.isWebGPU === true) {
        return createStellarNebulaNodeMaterial(params);
    }

    return createStellarNebulaShaderMaterial(params);
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

    const center = uv().sub(vec2(0.5, 0.5));
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

    const center = uv().sub(vec2(0.5, 0.5));
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

    const center = uv().sub(vec2(0.5, 0.5));
    const dist = length(center);
    const softCircle = smoothstep(float(0.65), float(0.0), dist);
    const hidden = vec3(0.0, 0.0, -9999.0);
    const hotCore = vec3(1.0, 0.92, 0.78).mul(particleLife.mul(0.2));
    const colorFalloff = particleColor.mul(float(0.48).add(particleLife.mul(0.52))).add(hotCore);

    material.positionNode = mix(hidden, particlePosition, particleActive);
    material.colorNode = colorFalloff.mul(particleActive);
    material.opacityNode = softCircle.mul(particleLife).mul(particleActive);
    material.sizeNode = particleSize.mul(float(0.4).add(particleLife.mul(0.72)));
    material.emissiveNode = colorFalloff.mul(float(0.3).add(particleLife.mul(0.5))).mul(particleActive);

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
    const surfaceTexture = params.surfaceTexture || null;

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
    const uvCoord = uv();
    const sampledSurface = surfaceTexture ? texture(surfaceTexture, uvCoord).rgb : null;

    material.colorNode = sampledSurface ? sampledSurface.mul(uColor) : uColor;
    material.emissiveNode = sampledSurface
        ? sampledSurface.mul(uEmissiveColor).mul(uEmissiveStrength)
        : uEmissiveColor.mul(uEmissiveStrength);
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
            uSurfaceMap: surfaceTexture,
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
    const surfaceTexture = params.surfaceTexture || null;

    const material = new THREE.MeshStandardMaterial({
        color: params.color ?? 0x7c6e66,
        map: surfaceTexture,
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
