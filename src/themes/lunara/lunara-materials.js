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
    pointUV,
    storage,
    vertexIndex,
    vec2,
    vec3,
    vec4,
    oneMinus,
    max,
} from 'three/tsl';
import {
    fbm3,
    warpFbm3,
    ridged3,
    voronoi3,
    LUNARA_GLSL_NOISE3,
} from './lunara-noise.js';

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
    const horizonScatter = mix(baseSky, uHorizonWarm, horizonBand.mul(0.34));

    // --- Nebula: domain-warped value-noise FBM (replaces the old tiling
    // sin-field product that produced the honeycomb artifact at the zenith). ---
    // Broad galactic band tilted off-axis, its edge broken up by noise so it
    // never reads as a hard ellipse.
    const bandAxis = normalize(vec3(0.42, 0.5, 0.76));
    const bandDot = abs(dot(dir, bandAxis));
    const bandJitter = fbm3(dir.mul(2.1), 4).mul(0.3);
    const band = smoothstep(float(0.64).add(bandJitter), float(0.04), bandDot);

    // Two-scale gas: domain-warped swirl + finer wisps, slowly drifting.
    const gasCoord = dir.mul(2.7).add(vec3(0.0, uTime.mul(0.005), 0.0));
    const gas = warpFbm3(gasCoord, 1.05, 5);
    const fineGas = fbm3(dir.mul(7.4).add(vec3(uTime.mul(0.004), 0.0, 0.0)), 4);
    const gasDensity = clamp(
        gas.mul(0.85).add(fineGas.mul(0.32)).sub(0.2),
        float(0.0),
        float(1.0),
    );

    // Dark dust lanes carve into the gas for depth.
    const dust = fbm3(dir.mul(3.6).add(vec3(11.3, 4.7, 19.1)), 4);
    const dustCut = oneMinus(smoothstep(float(0.34), float(0.6), dust).mul(0.78));

    const skyMask = smoothstep(float(-0.04), float(0.2), h); // hide below horizon
    const nebAmt = band.mul(skyMask).mul(gasDensity).mul(dustCut).mul(uNebulaIntensity.mul(3.4));

    // Colour temperature: violet core → rose edges, with teal accents in the
    // densest knots (Duncan's complementary-colour rule).
    const rose = vec3(1.0, 0.5, 0.82);
    const teal = vec3(0.42, 0.95, 1.0);
    let nebColor = mix(uNebula, rose, smoothstep(float(0.3), float(0.85), fineGas));
    nebColor = mix(nebColor, teal, smoothstep(float(0.62), float(0.98), gas).mul(0.45));

    const withNebula = horizonScatter.add(nebColor.mul(nebAmt));

    material.colorNode = withNebula;
    // Emissive: only the brightest gas knots seed bloom, keeping the dome calm.
    material.emissiveNode = nebColor.mul(nebAmt.mul(nebAmt).mul(0.6)).add(withNebula.mul(0.05));

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

            ${LUNARA_GLSL_NOISE3}

            void main() {
                vec3 dir = normalize(vWorldDir);
                float h = clamp(dir.y, -1.0, 1.0);

                float tLow = smoothstep(-0.1, 0.18, h);
                float tHigh = smoothstep(0.18, 0.85, h);
                vec3 lowToMid = mix(uHorizon, uMid, tLow);
                vec3 baseSky = mix(lowToMid, uZenith, tHigh);

                float horizonBand = smoothstep(0.06, -0.02, h)
                                  * smoothstep(-0.08, -0.02, h);
                vec3 withScatter = mix(baseSky, uHorizonWarm, horizonBand * 0.34);

                // --- Domain-warped FBM nebula (mirrors the WebGPU path) ---
                vec3 bandAxis = normalize(vec3(0.42, 0.5, 0.76));
                float bandDot = abs(dot(dir, bandAxis));
                float bandJitter = lunaraFbm3(dir * 2.1, 4) * 0.3;
                float band = smoothstep(0.64 + bandJitter, 0.04, bandDot);

                vec3 gasCoord = dir * 2.7 + vec3(0.0, uTime * 0.005, 0.0);
                vec3 warp = lunaraWarpFbm3Vec(gasCoord, 5) * 1.05;
                float gas = lunaraFbm3(gasCoord + warp, 5);
                float fineGas = lunaraFbm3(dir * 7.4 + vec3(uTime * 0.004, 0.0, 0.0), 4);
                float gasDensity = clamp(gas * 0.85 + fineGas * 0.32 - 0.2, 0.0, 1.0);

                float dust = lunaraFbm3(dir * 3.6 + vec3(11.3, 4.7, 19.1), 4);
                float dustCut = 1.0 - smoothstep(0.34, 0.6, dust) * 0.78;

                float skyMask = smoothstep(-0.04, 0.2, h);
                float nebAmt = band * skyMask * gasDensity * dustCut * uNebulaIntensity * 3.4;

                vec3 rose = vec3(1.0, 0.5, 0.82);
                vec3 teal = vec3(0.42, 0.95, 1.0);
                vec3 nebColor = mix(uNebula, rose, smoothstep(0.3, 0.85, fineGas));
                nebColor = mix(nebColor, teal, smoothstep(0.62, 0.98, gas) * 0.45);

                vec3 finalColor = withScatter + nebColor * nebAmt;
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
    const aSpike = attribute('aSpike');
    const aColor = attribute('color');

    const twinkle = sin(uTime.mul(aTwinkleSpeed).add(aPhase)).mul(0.5).add(0.5);
    const color = aColor.mul(twinkle.mul(0.4).add(0.7));

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.vertexColors = true;
    // Hero stars (aSpike>0) render larger so their diffraction cross is visible.
    material.sizeNode = clamp(
        aSize.mul(twinkle.mul(0.5).add(0.75)).mul(aSpike.mul(2.4).add(1.0)),
        float(0.6),
        float(16.0),
    );

    const c = uv().sub(0.5);
    const d = length(c).mul(2.0);
    const disc = pow(oneMinus(smoothstep(float(0.0), float(1.0), d)), float(1.8));
    // 4-point diffraction cross, gated to hero stars only.
    const crossX = oneMinus(smoothstep(float(0.0), float(0.5), abs(c.x)))
        .mul(oneMinus(smoothstep(float(0.0), float(0.05), abs(c.y))));
    const crossY = oneMinus(smoothstep(float(0.0), float(0.5), abs(c.y)))
        .mul(oneMinus(smoothstep(float(0.0), float(0.05), abs(c.x))));
    const cross = max(crossX, crossY).mul(aSpike);
    const shape = clamp(disc.add(cross.mul(0.65)), float(0.0), float(1.0));

    const alpha = shape.mul(twinkle.mul(0.5).add(0.4));
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.7));

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
            attribute float aSpike;
            uniform float uTime;
            varying vec3 vColor;
            varying float vTwinkle;
            varying float vSpike;
            void main() {
                vColor = color;
                float twinkle = sin(uTime * aTwinkleSpeed + aPhase) * 0.5 + 0.5;
                vTwinkle = twinkle;
                vSpike = aSpike;
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPos;
                float size = aSize * (twinkle * 0.5 + 0.75) * (aSpike * 2.4 + 1.0);
                gl_PointSize = clamp(size, 0.6, 16.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vTwinkle;
            varying float vSpike;
            void main() {
                vec2 c = gl_PointCoord - 0.5;
                float d = length(c) * 2.0;
                float disc = pow(1.0 - smoothstep(0.0, 1.0, d), 1.8);
                float crossX = (1.0 - smoothstep(0.0, 0.5, abs(c.x)))
                             * (1.0 - smoothstep(0.0, 0.05, abs(c.y)));
                float crossY = (1.0 - smoothstep(0.0, 0.5, abs(c.y)))
                             * (1.0 - smoothstep(0.0, 0.05, abs(c.x)));
                float cross = max(crossX, crossY) * vSpike;
                float shape = clamp(disc + cross * 0.65, 0.0, 1.0);
                if (shape < 0.003) discard;
                float alpha = shape * (vTwinkle * 0.5 + 0.4);
                vec3 col = vColor * (vTwinkle * 0.4 + 0.7);
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'star' });
}

// ---------------------------------------------------------------------------
// Aurora curtains — additive scrolling FBM ribbons (surge on combos)
// ---------------------------------------------------------------------------

export function createLunaraAuroraMaterialWebGPU(params = {}) {
    const uColorLow = uniform(params.colorLow ?? new THREE.Color(0x34ffc4)); // teal base
    const uColorHigh = uniform(params.colorHigh ?? new THREE.Color(0xc15bff)); // magenta tips
    const uOpacity = uniform(params.opacity ?? 0.16);
    const uSurge = uniform(0);
    const uTime = uniform(0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;

    const u = uv();
    const coord = vec3(u.x.mul(3.0).add(uTime.mul(0.03)), u.y.mul(1.5), uTime.mul(0.02));
    const swirl = warpFbm3(coord, 0.8, 4);
    const streak = ridged3(vec3(u.x.mul(9.0), u.y.mul(0.6), uTime.mul(0.05)), 3);
    const curtain = swirl.mul(0.55).add(streak.mul(0.55));
    const yFade = smoothstep(float(0.0), float(0.35), u.y)
        .mul(smoothstep(float(1.0), float(0.5), u.y));
    const intensity = curtain.mul(yFade);

    const color = mix(uColorLow, uColorHigh, clamp(u.y.add(swirl.mul(0.25)), float(0.0), float(1.0)));
    const alpha = intensity.mul(uOpacity).mul(uSurge.mul(2.2).add(1.0));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(1.3));

    return setUserData(material, {
        uColorLow, uColorHigh, uOpacity, uSurge, uTime,
    }, { emitsBloom: true, mrtRole: 'aurora' });
}

export function createLunaraAuroraMaterialWebGL(params = {}) {
    const uniforms = {
        uColorLow: { value: params.colorLow ?? new THREE.Color(0x34ffc4) },
        uColorHigh: { value: params.colorHigh ?? new THREE.Color(0xc15bff) },
        uOpacity: { value: params.opacity ?? 0.16 },
        uSurge: { value: 0 },
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
            uniform vec3 uColorLow;
            uniform vec3 uColorHigh;
            uniform float uOpacity;
            uniform float uSurge;
            uniform float uTime;
            varying vec2 vUv;

            ${LUNARA_GLSL_NOISE3}

            void main() {
                vec3 coord = vec3(vUv.x * 3.0 + uTime * 0.03, vUv.y * 1.5, uTime * 0.02);
                vec3 warp = lunaraWarpFbm3Vec(coord, 4) * 0.8;
                float swirl = lunaraFbm3(coord + warp, 4);
                float streak = lunaraFbm3(vec3(vUv.x * 9.0, vUv.y * 0.6, uTime * 0.05), 3);
                float curtain = swirl * 0.6 + streak * 0.5;
                float yFade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
                float intensity = curtain * yFade;
                vec3 color = mix(uColorLow, uColorHigh, clamp(vUv.y + swirl * 0.25, 0.0, 1.0));
                float alpha = intensity * uOpacity * (uSurge * 2.2 + 1.0);
                gl_FragColor = vec4(color * (1.0 + alpha), alpha);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'aurora' });
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
// Moon atmosphere shell — front-side fresnel rim on an over-sized sphere so the
// limb glow is true geometry (replaces relying on the flat billboard halo alone).
// ---------------------------------------------------------------------------

export function createLunaraAtmosphereMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0x9a5cff));
    const uPower = uniform(params.power ?? 3.2);
    const uIntensity = uniform(params.intensity ?? 1.0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.FrontSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;

    const n = normalize(normalWorld);
    const view = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(dot(n, view), float(0.0), float(1.0));
    const rim = pow(oneMinus(ndotv), uPower);
    const a = rim.mul(uIntensity);

    material.colorNode = uColor;
    material.opacityNode = a;
    material.emissiveNode = uColor.mul(a.mul(1.4));

    return setUserData(material, {
        uColor, uPower, uIntensity,
    }, { emitsBloom: true, mrtRole: 'atmosphere' });
}

export function createLunaraAtmosphereMaterialWebGL(params = {}) {
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0x9a5cff) },
        uPower: { value: params.power ?? 3.2 },
        uIntensity: { value: params.intensity ?? 1.0 },
    };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vViewDir = normalize(cameraPosition - worldPos.xyz);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uPower;
            uniform float uIntensity;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            void main() {
                float ndotv = clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0);
                float rim = pow(1.0 - ndotv, uPower);
                float a = rim * uIntensity;
                gl_FragColor = vec4(uColor * (1.0 + a * 0.4), a);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'atmosphere' });
}

// ---------------------------------------------------------------------------
// Planetary ring — samples a radial alpha strip across a flat disc.
// ---------------------------------------------------------------------------

export function createLunaraRingMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0xe8d4a8));
    const uOpacity = uniform(params.opacity ?? 0.9);
    const uInner = uniform(params.innerRadius ?? 1.3);
    const uOuter = uniform(params.outerRadius ?? 2.3);
    const ringMap = params.map ?? null;

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.fog = false;

    const r = length(positionLocal.xy);
    const t = clamp(r.sub(uInner).div(uOuter.sub(uInner)), float(0.0), float(1.0));
    let texColor = vec3(1.0, 1.0, 1.0);
    let texAlpha = float(1.0);
    if (ringMap) {
        const sample = texture(ringMap, vec2(t, 0.5));
        texColor = sample.xyz;
        texAlpha = sample.w;
    }
    const tint = texColor.mul(uColor);
    const a = texAlpha.mul(uOpacity);

    material.colorNode = tint;
    material.opacityNode = a;
    material.emissiveNode = tint.mul(a.mul(0.25));

    return setUserData(material, {
        uColor, uOpacity, uInner, uOuter,
    }, { mrtRole: 'ring' });
}

export function createLunaraRingMaterialWebGL(params = {}) {
    const hasMap = params.map instanceof THREE.Texture;
    const uniforms = {
        uColor: { value: params.color ?? new THREE.Color(0xe8d4a8) },
        uOpacity: { value: params.opacity ?? 0.9 },
        uInner: { value: params.innerRadius ?? 1.3 },
        uOuter: { value: params.outerRadius ?? 2.3 },
    };
    if (hasMap) uniforms.uMap = { value: params.map };

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        vertexShader: `
            varying vec2 vLocal;
            void main() {
                vLocal = position.xy;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uInner;
            uniform float uOuter;
            ${hasMap ? 'uniform sampler2D uMap;' : ''}
            varying vec2 vLocal;
            void main() {
                float r = length(vLocal);
                float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
                ${hasMap
        ? 'vec4 s = texture2D(uMap, vec2(t, 0.5)); vec3 tex = s.rgb; float ta = s.a;'
        : 'vec3 tex = vec3(1.0); float ta = 1.0;'}
                vec3 tint = tex * uColor;
                float a = ta * uOpacity;
                gl_FragColor = vec4(tint, a);
            }
        `,
    });

    return setUserData(material, uniforms, { mrtRole: 'ring' });
}

// ---------------------------------------------------------------------------
// Mountain ridge — atmospheric depth tint
// ---------------------------------------------------------------------------

export function createLunaraMountainMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0x3b1d6e));
    const uHaze = uniform(params.haze ?? new THREE.Color(0x6e3aae));
    const uHazeAmount = uniform(params.hazeAmount ?? 0.55);
    const uLightDir = uniform(params.lightDir ?? new THREE.Vector3(-0.4, 0.5, 0.6));
    const uTime = uniform(0);
    const uDetailStrength = uniform(params.detailStrength ?? 0.08);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.fog = true;
    material.side = WEBGPU.DoubleSide;

    const heightFactor = clamp(positionLocal.y.mul(0.04).add(0.5), float(0.0), float(1.0));
    const base = mix(uColor.mul(0.7), uColor, heightFactor);
    const horizonHaze = pow(oneMinus(heightFactor), float(2.0)).mul(uHazeAmount);
    let baseColor = mix(base, uHaze, horizonHaze);
    if (params.detailMap) {
        const detailScale = params.detailScale ?? 0.012;
        const detailSample = texture(params.detailMap, positionLocal.xz.mul(detailScale)).rgb;
        const detailLuma = dot(detailSample, vec3(0.299, 0.587, 0.114));
        const tooth = mix(float(1.0), mix(float(0.88), float(1.12), detailLuma), uDetailStrength);
        baseColor = baseColor.mul(tooth);
    }

    // Moon rim-light along the silhouette, biased toward the lit side.
    const n = normalize(normalWorld);
    const view = normalize(cameraPosition.sub(positionWorld));
    const lightDir = normalize(uLightDir);
    const lit = clamp(dot(n, lightDir), float(0.0), float(1.0));
    const rim = pow(oneMinus(clamp(dot(n, view), float(0.0), float(1.0))), float(3.2))
        .mul(lit.mul(0.7).add(0.3));
    const rimColor = uHaze.mul(rim).mul(0.28);

    // Crystalline mineral caps on the highest ridges (restrained — was whitewashing).
    const caps = smoothstep(float(0.74), float(0.98), heightFactor);
    const capColor = mix(uColor, vec3(0.7, 0.8, 1.0), float(0.35)).mul(caps).mul(0.22);

    const finalColor = baseColor.add(rimColor).add(capColor);
    material.colorNode = finalColor;
    material.emissiveNode = rimColor.mul(0.5).add(capColor.mul(0.6)).add(finalColor.mul(0.04));

    return setUserData(material, {
        uColor, uHaze, uHazeAmount, uLightDir, uTime, uDetailStrength,
    }, { mrtRole: 'mountain' });
}

export function createLunaraMountainMaterialWebGL(params = {}) {
    const hasDetailMap = Boolean(params.detailMap);
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uColor: { value: params.color ?? new THREE.Color(0x3b1d6e) },
            uHaze: { value: params.haze ?? new THREE.Color(0x6e3aae) },
            uHazeAmount: { value: params.hazeAmount ?? 0.55 },
            uLightDir: { value: (params.lightDir ?? new THREE.Vector3(-0.4, 0.5, 0.6)).clone().normalize() },
            uDetailMap: { value: params.detailMap ?? null },
            uDetailScale: { value: params.detailScale ?? 0.012 },
            uDetailStrength: { value: params.detailStrength ?? 0.08 },
            uUseDetailMap: { value: hasDetailMap ? 1 : 0 },
        },
    ]);

    const material = new THREE.ShaderMaterial({
        uniforms,
        fog: true,
        side: THREE.DoubleSide,
        vertexShader: `
            varying float vHeight;
            varying vec2 vDetailUv;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            #include <fog_pars_vertex>
            void main() {
                vHeight = position.y;
                vDetailUv = position.xz;
                vNormal = normalize(mat3(modelMatrix) * normal);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vViewDir = normalize(cameraPosition - worldPos.xyz);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uHaze;
            uniform float uHazeAmount;
            uniform vec3 uLightDir;
            uniform sampler2D uDetailMap;
            uniform float uDetailScale;
            uniform float uDetailStrength;
            uniform float uUseDetailMap;
            varying float vHeight;
            varying vec2 vDetailUv;
            varying vec3 vNormal;
            varying vec3 vViewDir;
            #include <fog_pars_fragment>
            void main() {
                float heightFactor = clamp(vHeight * 0.04 + 0.5, 0.0, 1.0);
                vec3 base = mix(uColor * 0.7, uColor, heightFactor);
                float horizonHaze = pow(1.0 - heightFactor, 2.0) * uHazeAmount;
                vec3 baseColor = mix(base, uHaze, horizonHaze);
                if (uUseDetailMap > 0.5) {
                    vec3 detailSample = texture2D(uDetailMap, vDetailUv * uDetailScale).rgb;
                    float detailLuma = dot(detailSample, vec3(0.299, 0.587, 0.114));
                    baseColor *= mix(1.0, mix(0.88, 1.12, detailLuma), uDetailStrength);
                }

                vec3 n = normalize(vNormal);
                vec3 view = normalize(vViewDir);
                float lit = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
                float rim = pow(1.0 - clamp(dot(n, view), 0.0, 1.0), 3.2) * (lit * 0.7 + 0.3);
                vec3 rimColor = uHaze * rim * 0.28;

                float caps = smoothstep(0.74, 0.98, heightFactor);
                vec3 capColor = mix(uColor, vec3(0.7, 0.8, 1.0), 0.35) * caps * 0.22;

                vec3 finalColor = baseColor + rimColor + capColor;
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

    const fastMaterial = params.fast === true;
    const material = fastMaterial
        ? new WEBGPU.MeshStandardNodeMaterial()
        : new WEBGPU.MeshPhysicalNodeMaterial();
    material.color = baseColor.clone();
    material.metalness = params.metalness ?? 0.0;
    material.roughness = params.roughness ?? 0.08;
    material.side = WEBGPU.DoubleSide;
    material.vertexColors = true;
    material.envMapIntensity = params.envMapIntensity ?? 1.3;

    if (!fastMaterial) {
        material.clearcoat = 0.55;
        material.clearcoatRoughness = 0.18;
    }

    if (!fastMaterial && params.useTransmission) {
        // True refraction — gated to hero crystals on Ultra/Extreme WebGPU.
        material.transmission = params.transmission ?? 0.92;
        material.ior = params.ior ?? 1.8;
        material.thickness = params.thickness ?? 2.6;
        material.attenuationColor = baseColor.clone();
        material.attenuationDistance = params.attenuationDistance ?? 7.0;
        material.transparent = true;
        material.depthWrite = true;
    } else {
        material.transparent = true;
        material.depthWrite = params.depthWrite ?? fastMaterial;
        material.opacity = params.opacity ?? 0.85;
    }

    const uEmissiveColor = uniform(emissiveColor);
    const uEmissiveStrength = uniform(params.emissiveStrength ?? 0.55);
    const uTime = uniform(0);

    // Edge fresnel — grow emissive on grazing angles
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(dot(normalize(normalWorld), viewDir), float(0.0), float(1.0));
    const fresnel = pow(oneMinus(ndotv), float(2.4));

    // Height-dependent emissive ramp: tips glow brightest.
    const heightNorm = clamp(positionLocal.y.mul(0.294).add(0.5), float(0.0), float(1.0));
    const tipRamp = pow(heightNorm, float(2.0));

    let fracture = float(0.0);
    if (!fastMaterial) {
        // Internal fracture planes via voronoi — faceted "cut crystal" interior.
        const fractureDist = voronoi3(positionLocal.mul(1.5).add(vec3(0.0, uTime.mul(0.04), 0.0)));
        fracture = oneMinus(smoothstep(float(0.0), float(0.14), fractureDist));
    }

    // Bright internal spine running up the crystal core.
    const spineDist = clamp(abs(positionLocal.x.add(positionLocal.z)).mul(0.7), float(0.0), float(1.0));
    const spine = pow(oneMinus(spineDist), float(3.0));

    // Vertical band so spires read as cut crystal
    const band = sin(positionLocal.y.mul(0.65).add(uTime.mul(0.4))).mul(0.5).add(0.5);
    const interior = uEmissiveColor.mul(band.mul(0.35).add(0.65));

    const emissiveFactor = fresnel.mul(0.42)
        .add(tipRamp.mul(0.42))
        .add(fracture.mul(0.32))
        .add(spine.mul(0.38))
        .add(0.12);
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
        metalness: params.metalness ?? 0.08,
        roughness: params.roughness ?? 0.14,
        transparent: true,
        depthWrite: false,
        opacity: params.opacity ?? 0.85,
        side: THREE.DoubleSide,
        vertexColors: true,
        emissive: emissiveColor,
        emissiveIntensity: 0.0, // driven by shader injection
        envMapIntensity: params.envMapIntensity ?? 1.1, // picks up scene.environment IBL
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
// Crystal caustics — animated additive decal projected on the ground under
// hero clusters. Sells the "glassy crystal bending light" read.
// ---------------------------------------------------------------------------

export function createLunaraCausticMaterialWebGPU(params = {}) {
    const uColor = uniform(params.color ?? new THREE.Color(0x9be0ff));
    const uOpacity = uniform(params.opacity ?? 0.5);
    const uTime = uniform(0);

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = true;

    const centered = uv().sub(0.5);
    const dist = length(centered).mul(2.0);
    const radial = oneMinus(smoothstep(float(0.0), float(1.0), dist));

    const v1 = voronoi3(vec3(uv().mul(7.0), uTime.mul(0.15)));
    const v2 = voronoi3(vec3(uv().mul(11.0).add(3.0), uTime.mul(-0.1)));
    const caustic = pow(oneMinus(v1), float(4.0)).add(pow(oneMinus(v2), float(5.0)).mul(0.6));

    const a = caustic.mul(radial).mul(uOpacity);
    material.colorNode = uColor;
    material.opacityNode = a;
    material.emissiveNode = uColor.mul(a.mul(1.2));

    return setUserData(material, {
        uColor, uOpacity, uTime,
    }, { emitsBloom: true, mrtRole: 'caustic' });
}

export function createLunaraCausticMaterialWebGL(params = {}) {
    const uniforms = THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
            uColor: { value: params.color ?? new THREE.Color(0x9be0ff) },
            uOpacity: { value: params.opacity ?? 0.5 },
            uTime: { value: 0 },
        },
    ]);

    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: true,
        vertexShader: `
            varying vec2 vUv;
            #include <fog_pars_vertex>
            void main() {
                vUv = uv;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;
            #include <fog_pars_fragment>

            ${LUNARA_GLSL_NOISE3}

            void main() {
                vec2 c = vUv - 0.5;
                float dist = length(c) * 2.0;
                float radial = 1.0 - smoothstep(0.0, 1.0, dist);
                // Cheap caustic from layered ridged FBM.
                float n1 = lunaraFbm3(vec3(vUv * 7.0, uTime * 0.15), 3);
                float n2 = lunaraFbm3(vec3(vUv * 11.0 + 3.0, uTime * -0.1), 3);
                float caustic = pow(1.0 - abs(n1 * 2.0 - 1.0), 4.0)
                              + pow(1.0 - abs(n2 * 2.0 - 1.0), 5.0) * 0.6;
                float a = caustic * radial * uOpacity;
                gl_FragColor = vec4(uColor * (1.0 + a), a);
                #include <fog_fragment>
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'caustic' });
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
// Reaction particles — event-driven additive resonance sparks
// ---------------------------------------------------------------------------

export function createLunaraReactionParticleMaterialWebGPU(params = {}) {
    const count = Math.max(1, params.count ?? 1);
    const positionLifeBuffer = params.positionLifeBuffer;
    const colorEnergyBuffer = params.colorEnergyBuffer;
    const miscBuffer = params.miscBuffer;
    const styleTimingBuffer = params.styleTimingBuffer;

    if (!positionLifeBuffer || !colorEnergyBuffer || !miscBuffer || !styleTimingBuffer) {
        throw new Error('createLunaraReactionParticleMaterialWebGPU requires storage buffers');
    }

    const uTime = uniform(0);
    const uSizeMul = uniform(params.sizeMul ?? 1.0);
    const uEmissiveMul = uniform(params.emissiveMul ?? 1.0);

    const lifeStore = storage(positionLifeBuffer, 'vec4', count);
    const colorStore = storage(colorEnergyBuffer, 'vec4', count);
    const miscStore = storage(miscBuffer, 'vec4', count);
    const timingStore = storage(styleTimingBuffer, 'vec4', count);

    const lifeData = lifeStore.element(vertexIndex);
    const colorData = colorStore.element(vertexIndex);
    const miscData = miscStore.element(vertexIndex);
    const timingData = timingStore.element(vertexIndex);

    const lifeNorm = clamp(lifeData.w.div(max(miscData.z, float(0.001))), float(0.0), float(1.0));
    const age = float(1.0).sub(lifeNorm);
    const birth = smoothstep(float(0.0), float(0.1), age);
    const delayGate = oneMinus(smoothstep(float(0.0), float(0.055), timingData.y));
    const typeLift = smoothstep(float(0.65), float(1.8), timingData.x).mul(0.25).add(1.0);
    const fade = birth.mul(lifeNorm).mul(delayGate);
    const twinkle = sin(uTime.mul(8.0).add(miscData.y.mul(6.283185))).mul(0.18).add(0.9);
    const size = miscData.x
        .mul(uSizeMul)
        .mul(max(timingData.z, float(0.65)).mul(0.22).add(0.86))
        .mul(fade.mul(0.95).add(0.08))
        .mul(twinkle)
        .mul(float(420.0).div(positionView.z.negate()));
    const energy = colorData.w.mul(fade);
    const coreLift = smoothstep(float(0.78), float(1.0), lifeNorm).mul(0.55);
    const brightness = energy.mul(1.95).add(coreLift).add(0.24).mul(typeLift);
    const particleColor = colorData.xyz.mul(brightness);

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;
    material.sizeNode = clamp(size, float(0.0), float(34.0));
    material.colorNode = particleColor;
    material.opacityNode = clamp(energy.mul(1.18), float(0.0), float(1.0));
    material.emissiveNode = particleColor.mul(uEmissiveMul);

    return setUserData(material, {
        uTime,
        uSizeMul,
        uEmissiveMul,
    }, { emitsBloom: true, mrtRole: 'reactionParticle' });
}

export function createLunaraReactionParticleMaterialWebGL(params = {}) {
    if (params.nodeCompatible === false) {
        const uniforms = {
            uTime: { value: 0 },
            uSizeMul: { value: params.sizeMul ?? 1.0 },
            uEmissiveMul: { value: params.emissiveMul ?? 1.0 },
        };

        const material = new THREE.ShaderMaterial({
            uniforms,
            transparent: true,
            depthWrite: false,
            depthTest: false,
            blending: THREE.AdditiveBlending,
            vertexColors: true,
            vertexShader: `
                attribute float aLife;
                attribute float aMaxLife;
                attribute float aSize;
                attribute float aEnergy;
                attribute float aPhase;
                attribute float aType;
                attribute float aDelay;
                attribute float aStretch;
                uniform float uTime;
                uniform float uSizeMul;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vEnergy;
                void main() {
                    float lifeNorm = clamp(aLife / max(aMaxLife, 0.001), 0.0, 1.0);
                    float age = 1.0 - lifeNorm;
                    float birth = smoothstep(0.0, 0.1, age);
                    float delayGate = 1.0 - smoothstep(0.0, 0.055, aDelay);
                    float fade = birth * lifeNorm * delayGate;
                    float typeLift = smoothstep(0.65, 1.8, aType) * 0.25 + 1.0;
                    float twinkle = sin(uTime * 8.0 + aPhase * 6.283185) * 0.18 + 0.9;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPosition;
                    gl_PointSize = clamp(aSize * uSizeMul * (fade * 0.95 + 0.08) * twinkle * (300.0 / -mvPosition.z) * (0.86 + max(aStretch, 0.65) * 0.22), 0.0, 22.0);
                    vColor = color;
                    vEnergy = aEnergy * fade * typeLift;
                    vAlpha = clamp(vEnergy * 0.52, 0.0, 0.5);
                }
            `,
            fragmentShader: `
                uniform float uEmissiveMul;
                varying vec3 vColor;
                varying float vAlpha;
                varying float vEnergy;
                void main() {
                    vec2 c = gl_PointCoord - 0.5;
                    float d = length(c) * 2.0;
                    if (d > 1.0 || vAlpha <= 0.001) discard;
                    float disc = smoothstep(1.0, 0.0, d);
                    float core = smoothstep(0.46, 0.0, d);
                    float alpha = vAlpha * disc;
                    vec3 col = vColor * (0.28 + vEnergy * 0.72 + core * 0.42) * uEmissiveMul;
                    gl_FragColor = vec4(col, alpha);
                }
            `,
        });

        return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'reactionParticle' });
    }

    const uTime = uniform(0);
    const uSizeMul = uniform(params.sizeMul ?? 1.0);
    const uEmissiveMul = uniform(params.emissiveMul ?? 1.0);

    const aLife = attribute('aLife');
    const aMaxLife = attribute('aMaxLife');
    const aSize = attribute('aSize');
    const aEnergy = attribute('aEnergy');
    const aPhase = attribute('aPhase');
    const aType = attribute('aType');
    const aDelay = attribute('aDelay');
    const aStretch = attribute('aStretch');
    const aColor = attribute('color', 'vec3');

    const lifeNorm = clamp(aLife.div(max(aMaxLife, float(0.001))), float(0.0), float(1.0));
    const age = float(1.0).sub(lifeNorm);
    const birth = smoothstep(float(0.0), float(0.1), age);
    const delayGate = oneMinus(smoothstep(float(0.0), float(0.055), aDelay));
    const fade = birth.mul(lifeNorm).mul(delayGate);
    const typeLift = smoothstep(float(0.65), float(1.8), aType).mul(0.25).add(1.0);
    const twinkle = sin(uTime.mul(8.0).add(aPhase.mul(6.283185))).mul(0.18).add(0.9);
    const size = aSize
        .mul(uSizeMul)
        .mul(max(aStretch, float(0.65)).mul(0.22).add(0.86))
        .mul(fade.mul(0.95).add(0.08))
        .mul(twinkle)
        .mul(float(420.0).div(positionView.z.negate()));
    const energy = aEnergy.mul(fade);
    const center = pointUV.sub(0.5);
    const dist = length(center).mul(2.0);
    const disc = smoothstep(float(1.0), float(0.0), dist);
    const core = smoothstep(float(0.46), float(0.0), dist);
    const brightness = float(0.5).add(energy.mul(1.85)).add(core.mul(1.3)).mul(typeLift);
    const color = aColor.mul(brightness).mul(uEmissiveMul);
    const alpha = clamp(energy.mul(1.08).mul(disc), float(0.0), float(1.0));

    const material = new WEBGPU.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;
    material.vertexColors = true;
    material.sizeNode = clamp(size, float(0.0), float(34.0));
    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha.mul(0.55));

    return setUserData(material, {
        uTime,
        uSizeMul,
        uEmissiveMul,
    }, { emitsBloom: true, mrtRole: 'reactionParticle' });
}

export function createLunaraHeroShardMaterialWebGPU(params = {}) {
    const uEmissiveMul = uniform(params.emissiveMul ?? 1.0);
    const aColor = attribute('aColor', 'vec3');
    const aAlpha = attribute('aAlpha');

    const centered = uv().sub(0.5);
    const cross = abs(centered.x).mul(2.0);
    const along = abs(centered.y).mul(2.0);
    const width = max(float(0.16), oneMinus(along.mul(0.78)));
    const body = oneMinus(smoothstep(width.mul(0.52), width, cross));
    const tipFade = oneMinus(smoothstep(float(0.86), float(1.0), along));
    const core = oneMinus(smoothstep(float(0.0), float(0.46), cross));
    const alpha = clamp(aAlpha.mul(body).mul(tipFade), float(0.0), float(0.95));
    const shardColor = aColor.mul(float(0.45).add(alpha.mul(1.8)).add(core.mul(0.85)));

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;
    material.colorNode = shardColor;
    material.opacityNode = alpha;
    material.emissiveNode = shardColor.mul(alpha.mul(1.15).mul(uEmissiveMul));

    return setUserData(material, { uEmissiveMul }, { emitsBloom: true, mrtRole: 'reactionShard' });
}

export function createLunaraHeroShardMaterialWebGL(params = {}) {
    const uniforms = {
        uEmissiveMul: { value: params.emissiveMul ?? 1.0 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: `
            attribute vec3 aColor;
            attribute float aAlpha;
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vUv = uv;
                vColor = aColor;
                vAlpha = aAlpha;
                vec4 worldPos = instanceMatrix * vec4(position, 1.0);
                gl_Position = projectionMatrix * modelViewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform float uEmissiveMul;
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            void main() {
                vec2 centered = vUv - 0.5;
                float cross = abs(centered.x) * 2.0;
                float along = abs(centered.y) * 2.0;
                float width = max(0.16, 1.0 - along * 0.78);
                float body = 1.0 - smoothstep(width * 0.52, width, cross);
                float tipFade = 1.0 - smoothstep(0.86, 1.0, along);
                float core = 1.0 - smoothstep(0.0, 0.46, cross);
                float alpha = clamp(vAlpha * body * tipFade, 0.0, 0.9);
                if (alpha <= 0.002) discard;
                vec3 col = vColor * (0.42 + alpha * 1.55 + core * 0.68) * uEmissiveMul;
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });
    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'reactionShard' });
}

export function createLunaraReactionRibbonMaterialWebGPU(params = {}) {
    const uColorA = uniform(params.colorA ?? new THREE.Color(0x7cf2ff));
    const uColorB = uniform(params.colorB ?? new THREE.Color(0xff7ac8));
    const uProgress = uniform(0);
    const uOpacity = uniform(params.opacity ?? 0.55);
    const uThickness = uniform(params.thickness ?? 0.08);
    const uArc = uniform(params.arc ?? 0.16);

    const coord = uv();
    const x = coord.x;
    const curve = sin(x.mul(Math.PI)).mul(uArc);
    const distance = abs(coord.y.sub(0.5).sub(curve));
    const line = oneMinus(smoothstep(uThickness, uThickness.mul(2.8), distance));
    const edgeFade = smoothstep(float(0.0), float(0.08), x)
        .mul(oneMinus(smoothstep(float(0.9), float(1.0), x)));
    const travel = smoothstep(uProgress.sub(0.42), uProgress, x)
        .mul(oneMinus(smoothstep(uProgress.add(0.08), uProgress.add(0.36), x)));
    const lifeFade = oneMinus(smoothstep(float(0.72), float(1.0), uProgress));
    const alpha = clamp(line.mul(edgeFade).mul(lifeFade).mul(uOpacity).mul(float(0.28).add(travel.mul(1.35))), float(0.0), float(0.9));
    const ribbonColor = mix(uColorA, uColorB, smoothstep(float(0.0), float(1.0), x)).mul(float(0.5).add(travel.mul(1.7)));

    const material = new WEBGPU.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = WEBGPU.DoubleSide;
    material.blending = WEBGPU.AdditiveBlending;
    material.fog = false;
    material.colorNode = ribbonColor;
    material.opacityNode = alpha;
    material.emissiveNode = ribbonColor.mul(alpha.mul(1.7));

    return setUserData(material, {
        uColorA, uColorB, uProgress, uOpacity, uThickness, uArc,
    }, { emitsBloom: true, mrtRole: 'reactionRibbon' });
}

export function createLunaraReactionRibbonMaterialWebGL(params = {}) {
    const uniforms = {
        uColorA: { value: params.colorA ?? new THREE.Color(0x7cf2ff) },
        uColorB: { value: params.colorB ?? new THREE.Color(0xff7ac8) },
        uProgress: { value: 0 },
        uOpacity: { value: params.opacity ?? 0.55 },
        uThickness: { value: params.thickness ?? 0.08 },
        uArc: { value: params.arc ?? 0.16 },
    };
    const material = new THREE.ShaderMaterial({
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
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
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            uniform float uProgress;
            uniform float uOpacity;
            uniform float uThickness;
            uniform float uArc;
            varying vec2 vUv;
            void main() {
                float x = vUv.x;
                float curve = sin(x * 3.14159265) * uArc;
                float distanceToLine = abs(vUv.y - 0.5 - curve);
                float line = 1.0 - smoothstep(uThickness, uThickness * 2.8, distanceToLine);
                float edgeFade = smoothstep(0.0, 0.08, x) * (1.0 - smoothstep(0.9, 1.0, x));
                float travel = smoothstep(uProgress - 0.42, uProgress, x)
                    * (1.0 - smoothstep(uProgress + 0.08, uProgress + 0.36, x));
                float lifeFade = 1.0 - smoothstep(0.72, 1.0, uProgress);
                float alpha = clamp(line * edgeFade * lifeFade * uOpacity * (0.24 + travel * 1.18), 0.0, 0.72);
                if (alpha <= 0.002) discard;
                vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 1.0, x)) * (0.44 + travel * 1.25);
                gl_FragColor = vec4(col, alpha);
            }
        `,
    });
    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'reactionRibbon' });
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
    material.metalness = 0.04; // matte mineral, not metallic/wet
    material.fog = true;
    material.envMapIntensity = 0.35;
    if (params.normalMap) {
        material.normalMap = params.normalMap;
        material.normalScale = new THREE.Vector2(0.3, 0.3);
    }
    if (params.roughnessMap) {
        material.roughnessMap = params.roughnessMap;
    }

    const uBaseColor = uniform(baseColor);
    const uVeinColor = uniform(veinColor);
    const uVeinStrength = uniform(params.veinStrength ?? 0.55);
    const uDetailStrength = uniform(params.detailStrength ?? 0.14);
    const uTime = uniform(0);

    // Planar coordinates (x, world -z). z is displaced height, so use xy.
    const p = positionLocal.xy;
    const detailScale = params.detailScale ?? 0.035;

    // Voronoi crack network → mineral veins concentrated along cell borders.
    const cell = voronoi3(vec3(p.mul(0.045), uTime.mul(0.01)));
    const veinMask = pow(oneMinus(smoothstep(float(0.0), float(0.1), cell)), float(2.4));

    // FBM tonal variation so the sand isn't a flat colour.
    const detail = fbm3(vec3(p.mul(0.02), float(0.0)), 4);
    let surfaceTooth = float(1.0);
    if (params.detailMap) {
        const detailSample = texture(params.detailMap, p.mul(detailScale)).rgb;
        const detailLuma = dot(detailSample, vec3(0.299, 0.587, 0.114));
        surfaceTooth = mix(float(1.0), mix(float(0.86), float(1.14), detailLuma), uDetailStrength);
    }
    const tone = uBaseColor.mul(detail.mul(0.5).add(0.78)).mul(surfaceTooth);

    material.colorNode = tone;
    material.emissiveNode = uVeinColor.mul(veinMask.mul(uVeinStrength));

    // Matte mineral valley: keep it rough overall, with only a faint "damp"
    // softening in the narrow centre seam (not a mirror — that read as water).
    const valleyMask = oneMinus(smoothstep(float(0.0), float(18.0), abs(p.x)));
    let roughnessBase = mix(
        float(0.92),
        float(0.7),
        valleyMask.mul(detail.mul(0.4).add(0.6)),
    );
    if (params.roughnessMap) {
        const roughSample = texture(params.roughnessMap, p.mul(detailScale)).r;
        const mappedRoughness = roughSample.mul(0.18).add(0.76);
        roughnessBase = mix(roughnessBase, mappedRoughness, float(0.25));
    }
    material.roughnessNode = roughnessBase;

    return setUserData(material, {
        uVeinColor, uVeinStrength, uDetailStrength, uTime,
    }, { emitsBloom: true, mrtRole: 'ground' });
}

export function createLunaraGroundMaterialWebGL(params = {}) {
    const baseColor = params.color ?? new THREE.Color(0x1a0d3a);
    const veinColor = params.veinColor ?? new THREE.Color(0x9b6dff);

    const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.92,
        metalness: 0.04,
        emissive: veinColor,
        emissiveIntensity: 0.0,
        envMapIntensity: 0.35,
        fog: true,
    });
    if (params.normalMap) {
        material.normalMap = params.normalMap;
        material.normalScale = new THREE.Vector2(0.3, 0.3);
    }
    if (params.roughnessMap) {
        material.roughnessMap = params.roughnessMap;
    }

    const uniforms = {
        uTime: { value: 0 },
        uVeinColor: { value: veinColor },
        uVeinStrength: { value: params.veinStrength ?? 0.55 },
        uDetailMap: { value: params.detailMap ?? null },
        uDetailScale: { value: params.detailScale ?? 0.035 },
        uDetailStrength: { value: params.detailStrength ?? 0.14 },
        uUseDetailMap: { value: params.detailMap ? 1 : 0 },
    };

    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.uniforms.uVeinColor = uniforms.uVeinColor;
        shader.uniforms.uVeinStrength = uniforms.uVeinStrength;
        shader.uniforms.uDetailMap = uniforms.uDetailMap;
        shader.uniforms.uDetailScale = uniforms.uDetailScale;
        shader.uniforms.uDetailStrength = uniforms.uDetailStrength;
        shader.uniforms.uUseDetailMap = uniforms.uUseDetailMap;
        shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             varying vec2 vGroundUv;`,
        );
        shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
             vGroundUv = position.xy;`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             uniform float uTime;
             uniform vec3 uVeinColor;
             uniform float uVeinStrength;
             uniform sampler2D uDetailMap;
             uniform float uDetailScale;
             uniform float uDetailStrength;
             uniform float uUseDetailMap;
             varying vec2 vGroundUv;
             ${LUNARA_GLSL_NOISE3}`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <color_fragment>',
            `#include <color_fragment>
             if (uUseDetailMap > 0.5) {
                 vec3 detailSample = texture2D(uDetailMap, vGroundUv * uDetailScale).rgb;
                 float detailLuma = dot(detailSample, vec3(0.299, 0.587, 0.114));
                 diffuseColor.rgb *= mix(1.0, mix(0.86, 1.14, detailLuma), uDetailStrength);
             }`,
        );
        // Faint damp seam down the narrow valley centre (matte, not a mirror).
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
             {
                 float valleyMask = 1.0 - smoothstep(0.0, 18.0, abs(vGroundUv.x));
                 roughnessFactor = mix(roughnessFactor, 0.7, valleyMask * 0.6);
             }`,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `
             vec2 gp = vGroundUv;
             // Ridged FBM approximates a crack/vein network.
             float crack = lunaraFbm3(vec3(gp * 0.045, uTime * 0.01), 4);
             float veinMask = pow(1.0 - abs(crack * 2.0 - 1.0), 3.0);
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
                float ring = smoothstep(uProgress - 0.04, uProgress, d)
                           * smoothstep(uProgress + 0.04, uProgress, d);
                float fade = 1.0 - uProgress;
                float a = ring * uOpacity * fade * 0.28;
                gl_FragColor = vec4(uColor * (0.42 + a * 0.45), a);
            }
        `,
    });

    return setUserData(material, uniforms, { emitsBloom: true, mrtRole: 'shockwave' });
}
