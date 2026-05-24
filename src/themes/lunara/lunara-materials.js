/* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
/**
 * Lunara Theme — Material factories.
 *
 * Dual render path:
 *   - WebGPU: TSL node materials with emissive output for MRT bloom.
 *   - WebGL2: ShaderMaterial / standard material fallbacks.
 *
 * Visual direction: a distant violet planet at night, lit by twin moons
 * (large purple primary + smaller red/pink companion). Crystals, bioluminescent
 * flora, and drifting motes against a deep nebular sky.
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';
import {
    abs,
    attribute,
    asin,
    atan,
    cameraPosition,
    clamp,
    dot,
    float,
    floor,
    fract,
    length,
    mix,
    normalize,
    normalLocal,
    normalWorld,
    positionLocal,
    positionView,
    positionWorld,
    pow,
    sin,
    smoothstep,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
} from 'three/tsl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUserData(material, uniforms = {}, extra = {}) {
    material.userData = {
        ...(material.userData || {}),
        uniforms,
        ...extra,
    };
    return { material, uniforms };
}

// ---------------------------------------------------------------------------
// Sky dome — deep violet with nebula bands
// ---------------------------------------------------------------------------

export function createLunaraSkyMaterialWebGPU(params = {}) {
    // Three-stop gradient (Duncan's complementary-color rule from NMS).
    // Zenith stays near-black so bioluminescence and stars have value contrast
    // to glow against (Outer Wilds discipline).
    const uZenith = uniform(params.zenith ?? new THREE.Color(0x05031a));
    const uMid = uniform(params.mid ?? new THREE.Color(0x21084a));
    const uHorizon = uniform(params.horizon ?? new THREE.Color(0x4d1a6e));
    const uHorizonWarm = uniform(params.horizonWarm ?? new THREE.Color(0xc04a8a));
    const uNebula = uniform(params.nebula ?? new THREE.Color(0xa48dff));
    const uNebulaIntensity = uniform(params.nebulaIntensity ?? 0.18);
    const uTime = uniform(0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.side = WEBGPU.BackSide;
    material.depthWrite = false;
    material.fog = false;

    const dir = normalize(positionWorld);
    const h = clamp(dir.y, float(-1.0), float(1.0));

    // Three-stop vertical gradient
    const tLow = smoothstep(float(-0.1), float(0.18), h); // horizon -> mid
    const tHigh = smoothstep(float(0.18), float(0.85), h); // mid -> zenith
    const lowToMid = mix(uHorizon, uMid, tLow);
    const baseSky = mix(lowToMid, uZenith, tHigh);

    // Warm horizon scatter — narrow band right at the horizon line.
    // Lifts the lower 0..0.06 of sky toward a complementary rose tone.
    const horizonBand = smoothstep(float(0.06), float(-0.02), h)
        .mul(smoothstep(float(-0.08), float(-0.02), h));
    const horizonScatter = mix(baseSky, uHorizonWarm, horizonBand.mul(0.55));

    // Cloudy nebula via product of three rotated sin-fields. This kills the
    // plane-wave stripes that a single dir-dot-sin produces.
    const sa = dir.x.mul(12.9).add(dir.y.mul(78.2)).add(dir.z.mul(37.7));
    const sb = dir.x.mul(-37.1).add(dir.y.mul(15.5)).add(dir.z.mul(92.3));
    const sc = dir.x.mul(45.8).add(dir.y.mul(-22.4)).add(dir.z.mul(61.1));
    const nA = sin(sa.mul(0.85)).mul(0.5).add(0.5);
    const nB = sin(sb.mul(1.55).add(uTime.mul(0.02))).mul(0.5).add(0.5);
    const nC = sin(sc.mul(0.55)).mul(0.5).add(0.5);
    const cloud = nA.mul(nB).mul(nC.mul(0.6).add(0.4));

    // Off-axis Milky-Way streak: tight band 30° wide centered on diagonal axis.
    const bandAxis = normalize(vec3(0.55, 0.62, 0.55));
    const bandDot = abs(dot(dir, bandAxis));
    const bandMask = smoothstep(float(0.6), float(0.28), bandDot);
    const skyMask = smoothstep(float(-0.05), float(0.25), h); // hide nebula below horizon
    const nebulaIntensity = bandMask.mul(skyMask).mul(cloud).mul(uNebulaIntensity);
    const nebulaTint = mix(uNebula, vec3(1.0, 0.7, 0.95), nC.mul(0.35));

    const withNebula = horizonScatter.add(nebulaTint.mul(nebulaIntensity));

    material.colorNode = withNebula;
    // Sky emissive contributes very softly so MRT bloom catches a hint of
    // brightness near the horizon-warm band but does not blow out the dome.
    material.emissiveNode = withNebula.mul(0.08);

    return setUserData(material, {
        uZenith, uMid, uHorizon, uHorizonWarm, uNebula, uNebulaIntensity, uTime,
    }, { mrtRole: 'sky' });
}

export function createLunaraSkyMaterialWebGL(params = {}) {
    const uniforms = {
        uZenith: { value: params.zenith ?? new THREE.Color(0x05031a) },
        uMid: { value: params.mid ?? new THREE.Color(0x21084a) },
        uHorizon: { value: params.horizon ?? new THREE.Color(0x4d1a6e) },
        uHorizonWarm: { value: params.horizonWarm ?? new THREE.Color(0xc04a8a) },
        uNebula: { value: params.nebula ?? new THREE.Color(0xa48dff) },
        uNebulaIntensity: { value: params.nebulaIntensity ?? 0.18 },
        uTime: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
            varying vec3 vWorldDir;
            void main() {
                vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                vWorldDir = normalize(worldPosition.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uZenith;
            uniform vec3 uMid;
            uniform vec3 uHorizon;
            uniform vec3 uHorizonWarm;
            uniform vec3 uNebula;
            uniform float uNebulaIntensity;
            uniform float uTime;
            varying vec3 vWorldDir;

            void main() {
                vec3 dir = normalize(vWorldDir);
                float h = clamp(dir.y, -1.0, 1.0);

                float tLow = smoothstep(-0.1, 0.18, h);
                float tHigh = smoothstep(0.18, 0.85, h);
                vec3 lowToMid = mix(uHorizon, uMid, tLow);
                vec3 baseSky = mix(lowToMid, uZenith, tHigh);

                float horizonBand = smoothstep(0.06, -0.02, h)
                                  * smoothstep(-0.08, -0.02, h);
                vec3 withScatter = mix(baseSky, uHorizonWarm, horizonBand * 0.55);

                float sa = dir.x * 12.9 + dir.y * 78.2 + dir.z * 37.7;
                float sb = dir.x * -37.1 + dir.y * 15.5 + dir.z * 92.3;
                float sc = dir.x * 45.8 + dir.y * -22.4 + dir.z * 61.1;
                float nA = sin(sa * 0.85) * 0.5 + 0.5;
                float nB = sin(sb * 1.55 + uTime * 0.02) * 0.5 + 0.5;
                float nC = sin(sc * 0.55) * 0.5 + 0.5;
                float cloud = nA * nB * (nC * 0.6 + 0.4);

                vec3 bandAxis = normalize(vec3(0.55, 0.62, 0.55));
                float bandDot = abs(dot(dir, bandAxis));
                float bandMask = smoothstep(0.6, 0.28, bandDot);
                float skyMask = smoothstep(-0.05, 0.25, h);
                float nebulaIntensity = bandMask * skyMask * cloud * uNebulaIntensity;
                vec3 nebulaTint = mix(uNebula, vec3(1.0, 0.7, 0.95), nC * 0.35);

                vec3 finalColor = withScatter + nebulaTint * nebulaIntensity;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
    });

    return setUserData(material, uniforms, { mrtRole: 'sky' });
}

// ---------------------------------------------------------------------------
// Starfield — PointsNodeMaterial / PointsMaterial fallback with twinkle
// ---------------------------------------------------------------------------

export function createLunaraStarMaterialWebGPU() {
    const uTime = uniform(0);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aTwinkleSpeed = attribute('aTwinkleSpeed');
    const aColor = attribute('color');

    const twinkle = sin(uTime.mul(aTwinkleSpeed).add(aPhase)).mul(0.5).add(0.5);
    const sizeNode = aSize.mul(twinkle.mul(0.6).add(0.7));
    const alpha = twinkle.mul(0.55).add(0.35);
    const color = aColor.mul(twinkle.mul(0.4).add(0.7));

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.vertexColors = true;
    material.sizeNode = clamp(sizeNode, float(0.6), float(8.5));
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.6));

    return setUserData(material, { uTime }, { emitsBloom: true, mrtRole: 'star' });
}

export function createLunaraStarMaterialWebGL() {
    const uniforms = { uTime: { value: 0 } };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexColors: true,
        vertexShader: `
            attribute float aSize;
            attribute float aPhase;
            attribute float aTwinkleSpeed;
            uniform float uTime;
            varying vec3 vColor;
            varying float vTwinkle;
            void main() {
                vColor = color;
                float twinkle = sin(uTime * aTwinkleSpeed + aPhase) * 0.5 + 0.5;
                vTwinkle = twinkle;
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPos;
                float size = aSize * (twinkle * 0.6 + 0.7);
                gl_PointSize = clamp(size, 0.6, 8.5);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vTwinkle;
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = length(c);
                if (d > 0.5) discard;
                float disc = smoothstep(0.5, 0.0, d);
                float alpha = (vTwinkle * 0.55 + 0.35) * disc;
                vec3 col = vColor * (vTwinkle * 0.4 + 0.7);
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'star' });
}

// ---------------------------------------------------------------------------
// TSL procedural noise helpers for moon surface
// ---------------------------------------------------------------------------

/** TSL 2D value noise (smooth interpolation between lattice values) */
function tslNoise2D(p) {
    const i = floor(p);
    const f = fract(p);
    // Hermite smoothstep for smooth interpolation
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    // Four lattice corners
    const a = fract(sin(dot(i, vec2(127.1, 311.7))).mul(43758.5453));
    const b = fract(sin(dot(i.add(vec2(1.0, 0.0)), vec2(127.1, 311.7))).mul(43758.5453));
    const c = fract(sin(dot(i.add(vec2(0.0, 1.0)), vec2(127.1, 311.7))).mul(43758.5453));
    const d = fract(sin(dot(i.add(vec2(1.0, 1.0)), vec2(127.1, 311.7))).mul(43758.5453));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** TSL FBM — 5 octaves of value noise */
function tslFBM(p, octaves = 5) {
    let value = float(0.0);
    let amplitude = float(0.5);
    let coord = p;
    for (let i = 0; i < octaves; i++) {
        value = value.add(tslNoise2D(coord).mul(amplitude));
        coord = coord.mul(2.1).add(vec2(1.3, 1.7));
        amplitude = amplitude.mul(0.5);
    }
    return value;
}

// ---------------------------------------------------------------------------
// Moon body — texture-mapped surface with FBM detail, craters, maria
// ---------------------------------------------------------------------------

export function createLunaraMoonMaterialWebGPU(params = {}) {
    // Deep tint color for the lit face; shade for the dark side.
    const uColor = uniform(params.color ?? new THREE.Color(0x3a1278));
    const uShade = uniform(params.shade ?? new THREE.Color(0x0d0420));
    const uMariaColor = uniform(params.mariaColor ?? new THREE.Color(0x1a0842));
    const uRimColor = uniform(params.rimColor ?? new THREE.Color(0x9040ff));
    const uLightDir = uniform(params.lightDir ?? new THREE.Vector3(0.4, 0.2, 1.0));
    const uEmissive = uniform(params.emissive ?? 0.12);
    const uTime = uniform(0);

    // Texture map for real surface detail (loaded by theme orchestrator)
    const surfaceMap = params.surfaceMap ?? null;

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.fog = false;

    const n = normalize(normalLocal);
    const view = normalize(cameraPosition.sub(positionWorld));
    const lightDir = normalize(uLightDir);
    const lit = clamp(dot(n, lightDir), float(0.0), float(1.0));
    // Sharper terminator for dramatic day/night boundary
    const terminator = pow(lit, float(1.8));

    // Spherical UV from normal (seamless, no pole pinch on a sphere geom)
    const sphereUV = vec2(
        float(0.5).add(atan(n.z, n.x).mul(0.15915)), // atan2 / 2π
        float(0.5).sub(asin(clamp(n.y, float(-1.0), float(1.0))).mul(0.31831)), // asin / π
    );

    // --- Surface texture layer ---
    let texColor;
    if (surfaceMap) {
        const texSample = texture(surfaceMap, sphereUV);
        // Extract luminance from greyscale/color texture, use as surface detail
        texColor = texSample.xyz;
    } else {
        texColor = vec3(0.5, 0.5, 0.5);
    }

    // --- Multi-octave procedural layers ---
    // Large-scale maria (dark basaltic plains) via low-frequency FBM
    const mariaCoord = sphereUV.mul(3.2);
    const mariaNoise = tslFBM(mariaCoord, 3);
    const mariaMask = smoothstep(float(0.42), float(0.58), mariaNoise);

    // Medium craters via FBM
    const craterCoord = sphereUV.mul(12.0);
    const craterNoise = tslFBM(craterCoord, 4);
    const craterMask = smoothstep(float(0.38), float(0.52), craterNoise);

    // Fine surface roughness
    const fineCoord = sphereUV.mul(28.0).add(vec2(uTime.mul(0.003), float(0.0)));
    const fineNoise = tslFBM(fineCoord, 3);

    // Combine: texture luminance modulated by procedural terrain
    const texLuma = dot(texColor, vec3(0.299, 0.587, 0.114));
    const surfaceDetail = texLuma.mul(0.6).add(fineNoise.mul(0.25)).add(0.15);
    const withCraters = surfaceDetail.mul(float(1.0).sub(craterMask.mul(0.35)));

    // Color: blend between main tint and dark maria regions
    const highlands = mix(uShade, uColor, terminator.mul(withCraters));
    const mariaBlend = mix(highlands, uMariaColor.mul(terminator.mul(0.6).add(0.15)), mariaMask.mul(0.55));

    // Cloud bands (gas-giant style latitude banding — subtle)
    const bandWave = sin(n.y.mul(14.0)).mul(0.5).add(0.5);
    const bandWave2 = sin(n.y.mul(9.3).add(uTime.mul(0.015))).mul(0.5).add(0.5);
    const bandMix = bandWave.mul(0.4).add(bandWave2.mul(0.3));
    const banded = mix(mariaBlend.mul(0.92), mariaBlend.mul(1.08), bandMix);

    // Rayleigh-style limb glow: atmospheric rim brighter than disc center
    const ndotv = clamp(dot(n, view), float(0.0), float(1.0));
    const limb = pow(float(1.0).sub(ndotv), float(3.5));
    const rimGlow = uRimColor.mul(limb.mul(lit.mul(0.85).add(0.15)).mul(1.6));

    // Subtle terminator color shift (warm-to-cool across day/night boundary)
    const terminatorGlow = uRimColor.mul(0.15).mul(
        smoothstep(float(0.15), float(0.4), lit).mul(smoothstep(float(0.6), float(0.4), lit)),
    );

    const finalColor = banded.add(rimGlow).add(terminatorGlow);

    material.colorNode = finalColor;
    // Emissive gated to rim + terminator glow so bloom catches atmosphere, not disc
    material.emissiveNode = rimGlow.mul(uEmissive.mul(2.5))
        .add(terminatorGlow.mul(uEmissive.mul(1.5)))
        .add(finalColor.mul(uEmissive.mul(0.3)));

    return setUserData(material, {
        uColor, uShade, uMariaColor, uRimColor, uLightDir, uEmissive, uTime,
    }, { emitsBloom: true, mrtRole: 'moon' });
}

export function createLunaraMoonMaterialWebGL(params = {}) {
    const hasSurfaceMap = params.surfaceMap instanceof THREE.Texture;
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0x3a1278) },
        uShade: { value: params.shade ?? new THREE.Color(0x0d0420) },
        uMariaColor: { value: params.mariaColor ?? new THREE.Color(0x1a0842) },
        uRimColor: { value: params.rimColor ?? new THREE.Color(0x9040ff) },
        uLightDir: { value: (params.lightDir ?? new THREE.Vector3(0.4, 0.2, 1.0)).clone().normalize() },
        uEmissive: { value: params.emissive ?? 0.12 },
        uTime: { value: 0 },
    };
    if (hasSurfaceMap) {
        uniforms.uSurfaceMap = { value: params.surfaceMap };
    }

    const material = new THREE.ShaderMaterial({
        uniforms,
        fog: false,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewDir;
            varying vec3 vObjNormal;
            void main() {
                vObjNormal = normalize(normal);
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vViewDir = normalize(cameraPosition - worldPos.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uShade;
            uniform vec3 uMariaColor;
            uniform vec3 uRimColor;
            uniform vec3 uLightDir;
            uniform float uEmissive;
            uniform float uTime;
            ${hasSurfaceMap ? 'uniform sampler2D uSurfaceMap;' : ''}
            varying vec3 vNormal;
            varying vec3 vViewDir;
            varying vec3 vObjNormal;

            // --- Noise helpers ---
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }
            float noise2D(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                vec2 u = f * f * (3.0 - 2.0 * f);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
            }
            float fbm(vec2 p, int octaves) {
                float value = 0.0;
                float amp = 0.5;
                for (int i = 0; i < 5; i++) {
                    if (i >= octaves) break;
                    value += noise2D(p) * amp;
                    p = p * 2.1 + vec2(1.3, 1.7);
                    amp *= 0.5;
                }
                return value;
            }

            void main() {
                vec3 n = normalize(vNormal);
                vec3 on = normalize(vObjNormal);
                vec3 view = normalize(vViewDir);
                float lit = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
                float terminator = pow(lit, 1.8);

                // Spherical UV from object-space normal
                vec2 sphereUV = vec2(
                    0.5 + atan(on.z, on.x) * 0.15915,
                    0.5 - asin(clamp(on.y, -1.0, 1.0)) * 0.31831
                );

                // Surface texture
                ${hasSurfaceMap
        ? 'vec3 texColor = texture2D(uSurfaceMap, sphereUV).rgb;'
        : 'vec3 texColor = vec3(0.5);'}
                float texLuma = dot(texColor, vec3(0.299, 0.587, 0.114));

                // Procedural layers
                float mariaNoise = fbm(sphereUV * 3.2, 3);
                float mariaMask = smoothstep(0.42, 0.58, mariaNoise);
                float craterNoise = fbm(sphereUV * 12.0, 4);
                float craterMask = smoothstep(0.38, 0.52, craterNoise);
                float fineNoise = fbm(sphereUV * 28.0 + vec2(uTime * 0.003, 0.0), 3);

                float surfaceDetail = texLuma * 0.6 + fineNoise * 0.25 + 0.15;
                float withCraters = surfaceDetail * (1.0 - craterMask * 0.35);

                vec3 highlands = mix(uShade, uColor, terminator * withCraters);
                vec3 mariaBlend = mix(highlands, uMariaColor * (terminator * 0.6 + 0.15), mariaMask * 0.55);

                float bandWave = sin(on.y * 14.0) * 0.5 + 0.5;
                float bandWave2 = sin(on.y * 9.3 + uTime * 0.015) * 0.5 + 0.5;
                float bandMix = bandWave * 0.4 + bandWave2 * 0.3;
                vec3 banded = mix(mariaBlend * 0.92, mariaBlend * 1.08, bandMix);

                // Rayleigh limb glow
                float ndotv = clamp(dot(n, view), 0.0, 1.0);
                float limb = pow(1.0 - ndotv, 3.5);
                vec3 rimGlow = uRimColor * limb * (lit * 0.85 + 0.15) * 1.6;

                // Terminator color shift
                float termBand = smoothstep(0.15, 0.4, lit) * smoothstep(0.6, 0.4, lit);
                vec3 terminatorGlow = uRimColor * 0.15 * termBand;

                vec3 finalColor = banded + rimGlow + terminatorGlow;
                vec3 emissiveOut = rimGlow * uEmissive * 2.5
                                 + terminatorGlow * uEmissive * 1.5
                                 + finalColor * uEmissive * 0.3;
                gl_FragColor = vec4(finalColor + emissiveOut, 1.0);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'moon' });
}

// ---------------------------------------------------------------------------
// Moon halo — soft additive billboard
// ---------------------------------------------------------------------------

export function createLunaraMoonHaloMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xc78cff));
    const uOpacity = uniform(params.opacity ?? 0.35);
    const uPower = uniform(params.power ?? 3.8);
    const uTime = uniform(0);

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const halo = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), uPower);
    const pulse = sin(uTime.mul(0.8)).mul(0.05).add(0.95);
    const alpha = halo.mul(uOpacity).mul(pulse);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;
    material.colorNode = uColor;
    material.opacityNode = alpha;
    material.emissiveNode = uColor.mul(alpha.mul(1.0));

    return setUserData(material, {
        uColor, uOpacity, uPower, uTime,
    }, { emitsBloom: true, mrtRole: 'moonHalo' });
}

export function createLunaraMoonHaloMaterialWebGL(params = {}) {
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0xc78cff) },
        uOpacity: { value: params.opacity ?? 0.35 },
        uPower: { value: params.power ?? 3.8 },
        uTime: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uPower;
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                vec2 c = vUv - 0.5;
                float d = length(c) * 2.0;
                float halo = pow(1.0 - smoothstep(0.0, 1.0, d), uPower);
                float pulse = sin(uTime * 0.8) * 0.05 + 0.95;
                float a = halo * uOpacity * pulse;
                gl_FragColor = vec4(uColor * (1.0 + a * 0.5), a);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'moonHalo' });
}

// ---------------------------------------------------------------------------
// Mountain ridge — atmospheric depth tint
// ---------------------------------------------------------------------------

export function createLunaraMountainMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0x3b1d6e));
    const uHaze = uniform(params.haze ?? new THREE.Color(0x6e3aae));
    const uHazeAmount = uniform(params.hazeAmount ?? 0.55);
    const uTime = uniform(0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.fog = true;

    const heightFactor = clamp(positionLocal.y.mul(0.04).add(0.5), float(0.0), float(1.0));
    const base = mix(uColor.mul(0.7), uColor, heightFactor);
    const horizonHaze = pow(float(1.0).sub(heightFactor), float(2.0)).mul(uHazeAmount);
    const final = mix(base, uHaze, horizonHaze);

    material.colorNode = final;
    // Ridges contribute a faint glow so they don't get fully crushed by bloom-tone
    material.emissiveNode = final.mul(0.06);

    return setUserData(material, {
        uColor, uHaze, uHazeAmount, uTime,
    }, { mrtRole: 'mountain' });
}

export function createLunaraMountainMaterialWebGL(params = {}) {
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uColor: { value: params.color ?? new THREE.Color(0x3b1d6e) },
            uHaze: { value: params.haze ?? new THREE.Color(0x6e3aae) },
            uHazeAmount: { value: params.hazeAmount ?? 0.55 },
        },
    ]);

    const material = new THREE.ShaderMaterial({
        uniforms,
        fog: true,
        vertexShader: `
            varying float vHeight;
            #include <fog_pars_vertex>
            void main() {
                vHeight = position.y;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uHaze;
            uniform float uHazeAmount;
            varying float vHeight;
            #include <fog_pars_fragment>
            void main() {
                float heightFactor = clamp(vHeight * 0.04 + 0.5, 0.0, 1.0);
                vec3 base = mix(uColor * 0.7, uColor, heightFactor);
                float horizonHaze = pow(1.0 - heightFactor, 2.0) * uHazeAmount;
                vec3 finalColor = mix(base, uHaze, horizonHaze);
                gl_FragColor = vec4(finalColor, 1.0);
                #include <fog_fragment>
            }
        `,
    });

    return setUserData(material, uniforms, { mrtRole: 'mountain' });
}

// ---------------------------------------------------------------------------
// Crystal spire — translucent purple with edge emissive (uses standard
// material so it picks up the moon directional lights for rim catch).
// ---------------------------------------------------------------------------

export function createLunaraCrystalMaterialWebGPU(params = {}) {
    const baseColor = params.color ?? new THREE.Color(0x9468d6);
    const emissiveColor = params.emissive ?? new THREE.Color(0xc086ff);

    const material = new WEBGPU.MeshStandardNodeMaterial();
    material.color = baseColor.clone();
    material.metalness = params.metalness ?? 0.05;
    material.roughness = params.roughness ?? 0.18;
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = params.opacity ?? 0.85;
    material.side = WEBGPU.DoubleSide;
    material.vertexColors = true;

    const uEmissiveColor = uniform(emissiveColor);
    const uEmissiveStrength = uniform(params.emissiveStrength ?? 0.55);
    const uTime = uniform(0);

    // Edge fresnel — grow emissive on grazing angles
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(dot(normalize(normalWorld), viewDir), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(ndotv), float(2.5));

    // Height-dependent emissive ramp: tips glow brightest.
    // ConeGeometry y goes from -1.7 (base) to +1.7 (tip), normalize to 0..1.
    const heightNorm = clamp(positionLocal.y.mul(0.294).add(0.5), float(0.0), float(1.0));
    const tipRamp = pow(heightNorm, float(2.0)); // quadratic — dark base, bright tip

    // Vertical band so spires read as cut crystal
    const band = sin(positionLocal.y.mul(0.65).add(uTime.mul(0.4))).mul(0.5).add(0.5);
    const interior = uEmissiveColor.mul(band.mul(0.4).add(0.6));

    // Combine: fresnel edge + height tip ramp
    const emissiveFactor = fresnel.mul(0.5).add(tipRamp.mul(0.5)).add(0.15);
    material.emissiveNode = interior.mul(emissiveFactor).mul(uEmissiveStrength);

    return setUserData(material, {
        uEmissiveColor, uEmissiveStrength, uTime,
    }, { emitsBloom: true, mrtRole: 'crystal' });
}

export function createLunaraCrystalMaterialWebGL(params = {}) {
    const baseColor = params.color ?? new THREE.Color(0x9468d6);
    const emissiveColor = params.emissive ?? new THREE.Color(0xc086ff);

    const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: params.metalness ?? 0.05,
        roughness: params.roughness ?? 0.18,
        transparent: true,
        depthWrite: false,
        opacity: params.opacity ?? 0.85,
        side: THREE.DoubleSide,
        vertexColors: true,
        emissive: emissiveColor,
        emissiveIntensity: 0.0, // driven by shader injection
    });

    const uniforms = {
        uTime: { value: 0 },
        uEmissiveColor: { value: emissiveColor },
        uEmissiveStrength: { value: params.emissiveStrength ?? 0.55 },
    };

    // Inject height-dependent emissive ramp into MeshStandardMaterial
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uEmissiveColor = uniforms.uEmissiveColor;
        shader.uniforms.uEmissiveStrength = uniforms.uEmissiveStrength;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             varying float vHeightNorm;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             // ConeGeometry y: -1.7..+1.7 → normalize to 0..1
             vHeightNorm = clamp(position.y * 0.294 + 0.5, 0.0, 1.0);`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             uniform float uTime;
             uniform vec3 uEmissiveColor;
             uniform float uEmissiveStrength;
             varying float vHeightNorm;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
             // Height-dependent tip glow (quadratic ramp)
             float tipRamp = pow(vHeightNorm, 2.0);
             float band = sin(vHeightNorm * 3.4 * 0.65 + uTime * 0.4) * 0.5 + 0.5;
             vec3 crystalEmissive = uEmissiveColor * (band * 0.4 + 0.6);
             float emFactor = tipRamp * 0.5 + 0.15;
             totalEmissiveRadiance += crystalEmissive * emFactor * uEmissiveStrength;
            `,
        );
    };

    material.userData = {
        uniforms,
        emissiveColor,
        baseEmissiveIntensity: material.emissiveIntensity,
        emitsBloom: true,
        mrtRole: 'crystal',
    };

    return { material, uniforms };
}

// ---------------------------------------------------------------------------
// Bioluminescent flora — additive sprite with soft pulsing core
// ---------------------------------------------------------------------------

export function createLunaraFloraMaterialWebGPU(params = {}) {
    const uTime = uniform(0);
    const uColorCore = uniform(params.colorCore ?? new THREE.Color(0xb1a0ff));
    const uColorEdge = uniform(params.colorEdge ?? new THREE.Color(0xff6fcf));

    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');

    const pulse = sin(uTime.mul(1.2).add(aPhase)).mul(0.5).add(0.5);

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = true;

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const core = pow(float(1.0).sub(smoothstep(float(0.0), float(1.0), dist)), float(2.5));
    const ring = smoothstep(float(0.55), float(0.0), dist).mul(smoothstep(float(0.0), float(0.55), dist));
    const tint = mix(uColorEdge, uColorCore, core);

    material.colorNode = tint;
    material.opacityNode = (core.add(ring.mul(0.45))).mul(pulse.mul(0.5).add(0.5));
    material.emissiveNode = tint.mul((core.add(ring.mul(0.6))).mul(pulse.mul(0.6).add(0.4)));
    material.sizeNode = clamp(
        aSize.mul(pulse.mul(0.22).add(0.9)).mul(float(270.0).div(positionView.z.negate())),
        float(3.0),
        float(48.0),
    );

    return setUserData(material, {
        uTime, uColorCore, uColorEdge,
    }, { emitsBloom: true, mrtRole: 'flora' });
}

export function createLunaraFloraMaterialWebGL(params = {}) {
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uTime: { value: 0 },
            uColorCore: { value: params.colorCore ?? new THREE.Color(0xb1a0ff) },
            uColorEdge: { value: params.colorEdge ?? new THREE.Color(0xff6fcf) },
        },
    ]);

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
        vertexShader: `
            attribute float aPhase;
            attribute float aSize;
            uniform float uTime;
            varying float vPulse;
            #include <fog_pars_vertex>
            void main() {
                float pulse = sin(uTime * 1.2 + aPhase) * 0.5 + 0.5;
                vPulse = pulse;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = clamp(aSize * (pulse * 0.22 + 0.9) * (270.0 / max(1.0, -mvPosition.z)), 3.0, 48.0);
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uColorCore;
            uniform vec3 uColorEdge;
            varying float vPulse;
            #include <fog_pars_fragment>
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = length(c) * 2.0;
                if (d > 1.0) discard;
                float core = pow(1.0 - smoothstep(0.0, 1.0, d), 2.5);
                float ring = smoothstep(0.55, 0.0, d) * smoothstep(0.0, 0.55, d);
                vec3 tint = mix(uColorEdge, uColorCore, core);
                float a = (core + ring * 0.45) * (vPulse * 0.5 + 0.5);
                vec3 col = tint * (core + ring * 0.6) * (vPulse * 0.6 + 0.4);
                gl_FragColor = vec4(col + tint * a * 0.4, a);
                #include <fog_fragment>
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'flora' });
}

// ---------------------------------------------------------------------------
// Floating motes — additive points
// ---------------------------------------------------------------------------

export function createLunaraMoteMaterialWebGPU(params = {}) {
    const uTime = uniform(0);
    const uColor = uniform(params.color ?? new THREE.Color(0xddc4ff));

    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');

    const twinkle = sin(uTime.mul(1.4).add(aPhase)).mul(0.5).add(0.5);

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = true;
    material.sizeNode = clamp(
        aSize.mul(twinkle.mul(0.6).add(0.7)).mul(float(220.0).div(positionView.z.negate())),
        float(0.8),
        float(10.0),
    );
    material.colorNode = uColor.mul(twinkle.mul(0.5).add(0.6));
    material.opacityNode = twinkle.mul(0.55).add(0.3);
    material.emissiveNode = uColor.mul(twinkle.mul(0.55).add(0.3));

    return setUserData(material, { uTime, uColor }, { emitsBloom: true, mrtRole: 'mote' });
}

export function createLunaraMoteMaterialWebGL(params = {}) {
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uTime: { value: 0 },
            uColor: { value: params.color ?? new THREE.Color(0xddc4ff) },
        },
    ]);

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: true,
        vertexShader: `
            attribute float aPhase;
            attribute float aSize;
            uniform float uTime;
            varying float vTwinkle;
            #include <fog_pars_vertex>
            void main() {
                float t = sin(uTime * 1.4 + aPhase) * 0.5 + 0.5;
                vTwinkle = t;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = clamp(aSize * (t * 0.6 + 0.7) * (220.0 / -mvPosition.z), 0.8, 10.0);
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            varying float vTwinkle;
            #include <fog_pars_fragment>
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = length(c);
                if (d > 0.5) discard;
                float disc = pow(1.0 - smoothstep(0.0, 0.5, d), 1.4);
                float a = disc * (vTwinkle * 0.55 + 0.3);
                vec3 col = uColor * (vTwinkle * 0.5 + 0.6);
                gl_FragColor = vec4(col, a);
                #include <fog_fragment>
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'mote' });
}

// ---------------------------------------------------------------------------
// Volumetric fog card — additive scrolling noise
// ---------------------------------------------------------------------------

export function createLunaraFogMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0x9c6cff));
    const uOpacity = uniform(params.opacity ?? 0.18);
    const uTime = uniform(0);
    const uScroll = uniform(params.scroll ?? new THREE.Vector2(0.04, 0.015));

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;

    const u = uv();
    const off = vec2(uScroll.x.mul(uTime), uScroll.y.mul(uTime));
    const seed1 = u.add(off);
    const seed2 = u.mul(2.3).add(off.mul(1.5).yx);
    const n1 = sin(seed1.x.mul(6.0)).mul(sin(seed1.y.mul(4.5))).mul(0.5).add(0.5);
    const n2 = sin(seed2.x.mul(11.0)).mul(sin(seed2.y.mul(8.7))).mul(0.5).add(0.5);
    const n = n1.mul(0.65).add(n2.mul(0.35));

    const yFade = smoothstep(float(0.0), float(0.4), u.y).mul(smoothstep(float(1.0), float(0.6), u.y));
    const xFade = smoothstep(float(0.0), float(0.2), u.x).mul(smoothstep(float(1.0), float(0.8), u.x));
    const fade = yFade.mul(xFade);
    const alpha = n.mul(fade).mul(uOpacity);

    material.colorNode = uColor;
    material.opacityNode = alpha;
    material.emissiveNode = uColor.mul(alpha.mul(0.7));

    return setUserData(material, {
        uColor, uOpacity, uTime, uScroll,
    }, { mrtRole: 'fog' });
}

export function createLunaraFogMaterialWebGL(params = {}) {
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0x9c6cff) },
        uOpacity: { value: params.opacity ?? 0.18 },
        uTime: { value: 0 },
        uScroll: { value: params.scroll ?? new THREE.Vector2(0.04, 0.015) },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            uniform vec2 uScroll;
            varying vec2 vUv;
            void main() {
                vec2 off = uScroll * uTime;
                vec2 s1 = vUv + off;
                vec2 s2 = vUv * 2.3 + off.yx * 1.5;
                float n1 = sin(s1.x * 6.0) * sin(s1.y * 4.5) * 0.5 + 0.5;
                float n2 = sin(s2.x * 11.0) * sin(s2.y * 8.7) * 0.5 + 0.5;
                float n = n1 * 0.65 + n2 * 0.35;
                float yFade = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
                float xFade = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
                float a = n * yFade * xFade * uOpacity;
                gl_FragColor = vec4(uColor, a);
            }
        `,
    });

    return setUserData(material, uniforms, { mrtRole: 'fog' });
}

// ---------------------------------------------------------------------------
// Ground — dark plane with TSL noise + faint emissive veins
// ---------------------------------------------------------------------------

export function createLunaraGroundMaterialWebGPU(params = {}) {
    const baseColor = params.color ?? new THREE.Color(0x1a0d3a);
    const veinColor = params.veinColor ?? new THREE.Color(0x9b6dff);

    const material = new WEBGPU.MeshStandardNodeMaterial();
    material.color = baseColor.clone();
    material.roughness = 0.78;
    material.metalness = 0.1;
    material.fog = true;

    const uVeinColor = uniform(veinColor);
    const uVeinStrength = uniform(params.veinStrength ?? 0.55);
    const uTime = uniform(0);

    const p = positionLocal.xz.mul(0.05);
    const n1 = sin(p.x.mul(2.3).add(uTime.mul(0.05))).mul(sin(p.y.mul(1.7)));
    const n2 = sin(p.x.mul(5.1).add(uTime.mul(0.07))).mul(sin(p.y.mul(4.3)));
    const ridges = abs(n1.add(n2.mul(0.4)));
    const veinMask = pow(float(1.0).sub(smoothstep(float(0.0), float(0.08), ridges)), float(3.0));

    material.emissiveNode = uVeinColor.mul(veinMask.mul(uVeinStrength));

    return setUserData(material, {
        uVeinColor, uVeinStrength, uTime,
    }, { emitsBloom: true, mrtRole: 'ground' });
}

export function createLunaraGroundMaterialWebGL(params = {}) {
    const baseColor = params.color ?? new THREE.Color(0x1a0d3a);
    const veinColor = params.veinColor ?? new THREE.Color(0x9b6dff);

    const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.78,
        metalness: 0.1,
        emissive: veinColor,
        emissiveIntensity: 0.0,
        fog: true,
    });

    const uniforms = {
        uTime: { value: 0 },
        uVeinColor: { value: veinColor },
        uVeinStrength: { value: params.veinStrength ?? 0.55 },
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uVeinColor = uniforms.uVeinColor;
        shader.uniforms.uVeinStrength = uniforms.uVeinStrength;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             varying vec2 vGroundUv;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vGroundUv = position.xz * 0.05;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             uniform float uTime;
             uniform vec3 uVeinColor;
             uniform float uVeinStrength;
             varying vec2 vGroundUv;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
             vec2 p = vGroundUv;
             float n1 = sin(p.x * 2.3 + uTime * 0.05) * sin(p.y * 1.7);
             float n2 = sin(p.x * 5.1 + uTime * 0.07) * sin(p.y * 4.3);
             float ridges = abs(n1 + n2 * 0.4);
             float veinMask = pow(1.0 - smoothstep(0.0, 0.08, ridges), 3.0);
             totalEmissiveRadiance += uVeinColor * veinMask * uVeinStrength;
            `,
        );
    };

    material.userData = {
        uniforms,
        emitsBloom: true,
        mrtRole: 'ground',
    };

    return { material, uniforms };
}

// ---------------------------------------------------------------------------
// Shockwave — additive ring for line-clear bursts
// ---------------------------------------------------------------------------

export function createLunaraShockwaveMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xc78cff));
    const uProgress = uniform(0);
    const uOpacity = uniform(params.opacity ?? 1.0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const ring = smoothstep(uProgress.sub(0.06), uProgress, dist)
        .mul(smoothstep(uProgress.add(0.06), uProgress, dist));
    const fade = float(1.0).sub(uProgress);
    const a = ring.mul(uOpacity).mul(fade);

    material.colorNode = uColor;
    material.opacityNode = a;
    material.emissiveNode = uColor.mul(a.mul(2.0));

    return setUserData(material, {
        uColor, uProgress, uOpacity,
    }, { emitsBloom: true, mrtRole: 'shockwave' });
}

export function createLunaraShockwaveMaterialWebGL(params = {}) {
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0xc78cff) },
        uProgress: { value: 0 },
        uOpacity: { value: params.opacity ?? 1.0 },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uProgress;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                vec2 c = vUv - 0.5;
                float d = length(c) * 2.0;
                float ring = smoothstep(uProgress - 0.06, uProgress, d)
                           * smoothstep(uProgress + 0.06, uProgress, d);
                float fade = 1.0 - uProgress;
                float a = ring * uOpacity * fade;
                gl_FragColor = vec4(uColor * (1.0 + a), a);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'shockwave' });
}
