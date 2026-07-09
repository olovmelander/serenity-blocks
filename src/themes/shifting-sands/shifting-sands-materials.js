/**
 * Shifting Sands Theme - TSL Materials
 * Three Shading Language (TSL) node materials for WebGPU/WebGL2 hybrid rendering
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    If,
    attribute,
    uniform,
    storage,
    varying,
    varyingProperty,
    positionLocal,
    positionWorld,
    normalLocal,
    normalWorld,
    normalView,
    cameraPosition,
    modelViewMatrix,
    modelNormalMatrix,
    float,
    int,
    vec2,
    vec3,
    vec4,
    mat3,
    sin,
    cos,
    fract,
    floor,
    abs,
    dot,
    length,
    normalize,
    reflect,
    mix,
    smoothstep,
    pow,
    max,
    min,
    clamp,
    exp,
    step,
    mod,
    cross,
    uv,
    transformDirection,
    vertexIndex,
    instanceIndex,
} from 'three/tsl';

// ============== TSL NOISE FUNCTIONS ==============

/**
 * Hash function for 3D input -> 3D output
 * Used for gradient noise generation
 */
const hash3 = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec3(p_immutable).toVar();
    p.assign(vec3(
        dot(p, vec3(127.1, 311.7, 74.7)),
        dot(p, vec3(269.5, 183.3, 246.1)),
        dot(p, vec3(113.5, 271.9, 124.6)),
    ));
    return fract(sin(p).mul(43758.5453123)).mul(2.0).sub(1.0);
});

/**
 * 3D Gradient Noise (Perlin-style)
 * Matches the GLSL noise function in the original shaders
 */
const noise3D = /* @__PURE__ */ Fn(([p_immutable]) => {
    const p = vec3(p_immutable).toVar();
    const i = floor(p);
    const f = fract(p);
    // Smooth interpolation (cubic Hermite)
    const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));

    // Trilinear interpolation of gradients
    const n000 = dot(hash3(i.add(vec3(0, 0, 0))), f.sub(vec3(0, 0, 0)));
    const n100 = dot(hash3(i.add(vec3(1, 0, 0))), f.sub(vec3(1, 0, 0)));
    const n010 = dot(hash3(i.add(vec3(0, 1, 0))), f.sub(vec3(0, 1, 0)));
    const n110 = dot(hash3(i.add(vec3(1, 1, 0))), f.sub(vec3(1, 1, 0)));
    const n001 = dot(hash3(i.add(vec3(0, 0, 1))), f.sub(vec3(0, 0, 1)));
    const n101 = dot(hash3(i.add(vec3(1, 0, 1))), f.sub(vec3(1, 0, 1)));
    const n011 = dot(hash3(i.add(vec3(0, 1, 1))), f.sub(vec3(0, 1, 1)));
    const n111 = dot(hash3(i.add(vec3(1, 1, 1))), f.sub(vec3(1, 1, 1)));

    return mix(
        mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
        mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
        u.z,
    );
});

/**
 * 2D Hash for random values
 */
const hash2D = /* @__PURE__ */ Fn(([p]) => {
    return fract(sin(dot(p.xy, vec2(12.9898, 78.233))).mul(43758.5453123));
});

// ============== DUNE MATERIAL ==============

/**
 * Creates a TSL-based Arrakis dune material with:
 * - Procedural wind ripples
 * - Worm trail displacement
 * - Journey-style rim lighting
 * - Spice sparkle
 * - Fog/atmospheric haze
 *
 * @param {Object} params - Material parameters
 * @param {THREE.Color} params.colorA - Deep shadow color
 * @param {THREE.Color} params.colorB - Golden sand color
 * @param {THREE.Color} params.colorC - Wheat highlight color
 * @param {THREE.Color} params.fogColor - Fog color
 * @param {number} params.fogNear - Fog near distance
 * @param {number} params.fogFar - Fog far distance
 * @param {THREE.Vector3} params.moonDirection - Light direction
 * @param {WormTrailCompute} params.wormTrailCompute - Worm compute instance (optional)
 * @param {boolean} params.isWebGPU - Whether using WebGPU backend
 */
export function createDuneMaterial(params) {
    const {
        colorA,
        colorB,
        colorC,
        fogColor,
        fogNear,
        fogFar,
        moonDirection,
        wormTrailCompute,
        isWebGPU,
    } = params;

    // Uniforms
    const uTime = uniform(0);
    const uColorA = uniform(colorA);
    const uColorB = uniform(colorB);
    const uColorC = uniform(colorC);
    const uMoonDirection = uniform(moonDirection);
    const uFogColor = uniform(fogColor);
    const uFogNear = uniform(fogNear);
    const uFogFar = uniform(fogFar);
    const uEnhance = uniform(0); // WebGPU-only enhancements strength

    // Worm uniforms for CPU fallback (WebGL path)
    const uWormHeadX = uniform(0);
    const uWormHeadZ = uniform(0);
    const uWormPathBaseX = uniform(0);
    const uWormPathSlope = uniform(0);

    const useGPUWorm = Boolean(isWebGPU && wormTrailCompute?.getWormStateBuffer);
    const wormState = useGPUWorm
        ? storage(wormTrailCompute.getWormStateBuffer(), 'vec4', 2)
        : null;

    // Varyings for fragment shader
    const vWormTrail = varying(float(0), 'vWormTrail');
    const vWormScar = varying(float(0), 'vWormScar');
    const vHeight = varying(float(0), 'vHeight');
    const vSlope = varying(float(0), 'vSlope');
    const vWorldPos = varying(vec3(0), 'vWorldPos');
    const vViewPos = varying(vec3(0), 'vViewPos');
    const vNormalW = varying(vec3(0), 'vNormalW');

    // ============== VERTEX SHADER (Position Node) ==============
    const positionNode = Fn(() => {
        const pos = positionLocal.toVar();
        const wormEffect = float(0).toVar();

        // --- WORM TRAIL CALCULATION ---
        // Use GPU-computed worm state when available; fallback to CPU uniforms
        const wormHeadX = useGPUWorm ? wormState.element(0).x : uWormHeadX;
        const wormHeadZ = useGPUWorm ? wormState.element(0).y : uWormHeadZ;
        const wormPathBaseX = useGPUWorm ? wormState.element(0).z : uWormPathBaseX;
        const wormPathSlope = useGPUWorm ? wormState.element(0).w : uWormPathSlope;
        // Add subtle meander to avoid a perfectly straight corridor
        const meander = noise3D(vec3(pos.z.mul(0.02), 0.0, uTime.mul(0.02))).mul(12.0);
        const wormPathX = wormPathBaseX.add(pos.z.mul(wormPathSlope)).add(meander);

        // Distance from worm path
        const distFromPath = abs(pos.x.sub(wormPathX));

        // Trail width - narrow like a real worm trail
        const trailWidth = float(28.0);
        const pathMask = exp(distFromPath.mul(distFromPath).mul(-1.0).div(trailWidth.mul(trailWidth)));

        // Distance from worm head
        const distFromHead = pos.z.sub(wormHeadZ);
        const headMask = smoothstep(320.0, 0.0, abs(distFromHead));

        // Ridge parameters
        const ridgeLength = float(150.0);
        const wakeLength = float(320.0);

        // Calculate ridge displacement
        const ridgeDisplacement = float(0).toVar();

        // Main ridge (ahead of head) - sand pushed up by the worm breaching
        const inRidge = distFromHead.greaterThan(0.0).and(distFromHead.lessThan(ridgeLength));
        If(inRidge, () => {
            const ridgeProgress = distFromHead.div(ridgeLength);
            ridgeDisplacement.assign(sin(ridgeProgress.mul(3.14159)).mul(24.0));
        });

        // Wake behind head - collapsed groove with oscillating ripples
        const inWake = distFromHead.greaterThanEqual(wakeLength.negate()).and(distFromHead.lessThanEqual(0.0));
        If(inWake, () => {
            const wakeProgress = distFromHead.negate().div(wakeLength);
            const wakeRipple = float(1.0).sub(wakeProgress)
                .mul(sin(wakeProgress.mul(4.0).add(uTime.mul(1.5)))).mul(8.0);
            // Sunken groove (negative displacement) where the worm has been
            const groove = float(1.0).sub(wakeProgress).mul(-6.0);
            ridgeDisplacement.assign(wakeRipple.add(groove));
        });

        // Apply worm displacement
        const wormMask = pathMask.mul(headMask);
        pos.y.addAssign(ridgeDisplacement.mul(wormMask));
        wormEffect.assign(wormMask.mul(step(0.5, ridgeDisplacement).mul(0.7).add(0.3)));

        // Long-reach scar trailing behind the worm (independent of headMask falloff).
        // Visible groove that fades out ~520 units behind the head along the worm path.
        const wakeDist = max(float(0.0), distFromHead.negate()); // 0 at head, positive behind
        const scarReach = float(520.0);
        const scarFade = float(1.0).sub(smoothstep(0.0, scarReach, wakeDist));
        // Pre-multiplied by the cross-section pathMask so it tapers laterally too.
        vWormScar.assign(clamp(pathMask.mul(scarFade), 0.0, 1.0));

        // Store varyings
        vWormTrail.assign(clamp(wormEffect, 0.0, 1.0));
        vHeight.assign(pos.y);

        return pos;
    })();

    // ============== FRAGMENT SHADER (Color Node) ==============
    const colorNode = Fn(() => {
        const worldPos = positionWorld;
        const normal = normalWorld;
        const camPos = cameraPosition;
        const viewDir = normalize(camPos.sub(worldPos));

        // --- 1. WIND-CARVED RIPPLE NORMAL MAPPING ---
        const rippleScale = float(0.4);
        const ripplePos = worldPos.mul(rippleScale);

        // Directional ripples following wind
        const windAngle = float(0.2 * Math.PI);
        const windDirX = cos(windAngle);
        const windDirZ = sin(windAngle);
        const windDot = worldPos.x.mul(windDirX).add(worldPos.z.mul(windDirZ));

        const windRipple = noise3D(vec3(
            windDot.mul(0.8),
            worldPos.y.mul(0.1),
            uTime.mul(0.01),
        ));

        const n1 = noise3D(ripplePos.add(vec3(0.0, 0.0, uTime.mul(0.015))));
        const n2 = noise3D(ripplePos.mul(2.5).add(vec3(5.2, 1.3, uTime.mul(-0.01))));

        // Perturb normal based on ripples
        const rippleIntensity = float(0.2);
        const disturbedNormal = normalize(normal.add(vec3(
            n1.add(windRipple.mul(0.5)),
            0.0,
            n2,
        ).mul(rippleIntensity)));

        // --- 2. DIFFUSE LIGHTING (Arrakis harsh sunlight) ---
        const NdotL = dot(disturbedNormal, uMoonDirection);
        const lightIntensity = smoothstep(0.2, 0.8, NdotL.mul(0.5).add(0.5));

        // Mix colors: shadow -> golden -> highlight
        const finalColor = mix(uColorA, uColorB, smoothstep(0.2, 0.5, lightIntensity)).toVar();
        finalColor.assign(mix(finalColor, uColorC, smoothstep(0.7, 1.0, lightIntensity)));

        // --- 2b. SHADOW DEPTH (enhance darker pockets) ---
        const shadow = smoothstep(0.0, 0.7, float(1.0).sub(lightIntensity));
        const slopeShadow = smoothstep(0.2, 0.85, float(1.0).sub(disturbedNormal.y));

        // Directional shadowing to deepen the lee side
        const lightDir = normalize(uMoonDirection);
        const shadeDir = dot(disturbedNormal, lightDir).mul(0.5).add(0.5);
        const directionalShadow = smoothstep(0.55, 0.05, shadeDir);

        const shadowMix = clamp(
            shadow.mul(0.45).add(slopeShadow.mul(0.35)).add(directionalShadow.mul(0.5)),
            0.0,
            1.0,
        );
        finalColor.assign(mix(finalColor, uColorA, shadowMix.mul(0.55)));

        // --- 3. RIM LIGHTING (Enhanced for dramatic silhouettes) ---
        const NdotV = dot(disturbedNormal, viewDir);
        const rim = pow(float(1.0).sub(max(0.0, NdotV)), 2.5);
        const rimIntensity = rim.mul(NdotL.mul(0.4).add(0.6));
        finalColor.addAssign(uColorC.mul(rimIntensity).mul(0.6));

        // --- 3b. SUBSURFACE SCATTERING (WebGPU enhancement) ---
        const backLight = pow(max(0.0, dot(disturbedNormal.negate(), uMoonDirection)), 2.0);
        const scatter = uColorC.mul(backLight).mul(0.35).mul(uEnhance);
        finalColor.addAssign(scatter);

        // --- 4. SPICE GLITTER (Orange sparkles) ---
        // Screen-space sparkle based on world position
        const sparkleUV = worldPos.xz.mul(80.0);
        const sparkleRand = fract(sin(dot(floor(sparkleUV), vec2(12.9898, 78.233))).mul(43758.5453));

        const reflectDir = reflect(uMoonDirection.negate(), disturbedNormal);
        const specular = pow(max(0.0, dot(reflectDir, viewDir)), 16.0);
        const sparkleMask = step(0.97, sparkleRand).mul(specular).mul(lightIntensity);

        // Orange spice sparkle
        const spiceSparkle = vec3(1.0, 0.6, 0.2);
        finalColor.addAssign(spiceSparkle.mul(sparkleMask).mul(3.0));

        // --- 5. HEIGHT-BASED COLOR VARIATION ---
        const heightFactor = smoothstep(-30.0, 20.0, vHeight);
        finalColor.assign(mix(finalColor.mul(0.85), finalColor, heightFactor));

        // --- 5b. SAND FLOW SHEEN (WebGPU enhancement) ---
        const flowNoise = noise3D(worldPos.mul(0.05).add(vec3(uTime.mul(0.03), 0.0, uTime.mul(0.02))));
        const flowSheen = flowNoise.mul(0.08).mul(uEnhance);
        finalColor.addAssign(uColorB.mul(flowSheen));

        // --- 6. FOG & ATMOSPHERIC HAZE ---
        const dist = length(worldPos.sub(camPos));
        const fogFactor = smoothstep(uFogNear, uFogFar, dist);
        finalColor.assign(mix(finalColor, uFogColor, fogFactor));

        // --- 7. WORM TRAIL DUST EFFECT ---
        // Derive trail tint from active dune palette so theme shifts stay cohesive.
        const dustColor = mix(uColorA.mul(0.9), uColorB.mul(0.95), 0.62);
        const dustNoise = noise3D(worldPos.mul(0.1).add(vec3(uTime.mul(0.5), 0.0, uTime.mul(0.3))));
        const dustIntensity = clamp(
            vWormTrail.mul(float(0.22).add(dustNoise.mul(0.12))),
            0.0,
            0.35,
        );
        finalColor.assign(mix(finalColor, dustColor, dustIntensity.mul(step(0.12, vWormTrail))));

        // --- 7b. WORM SCAR - long darkened groove trailing the sandworm ---
        // The scar makes the worm's path visibly carved into the desert across hundreds of units.
        const scarShadow = uColorA.mul(0.55);
        const scarNoise = noise3D(worldPos.mul(0.18).add(vec3(0.0, uTime.mul(0.04), 0.0)));
        // Edge softening: stronger near center of the path, with light noise breakup.
        const scarStrength = vWormScar.mul(float(0.62).add(scarNoise.mul(0.18)));
        finalColor.assign(mix(finalColor, scarShadow, clamp(scarStrength, 0.0, 0.6)));

        // Subtle warm dust haze sitting ON TOP of the scar (sand still settling in the groove)
        const haze = mix(uColorB.mul(0.85), uColorC.mul(0.6), 0.4);
        const hazeNoise = noise3D(worldPos.mul(0.05).add(vec3(uTime.mul(0.2), 0.0, uTime.mul(0.12))));
        const hazeMix = vWormScar.mul(float(0.10).add(hazeNoise.mul(0.10)));
        finalColor.assign(mix(finalColor, haze, clamp(hazeMix, 0.0, 0.18)));

        return vec4(finalColor, 1.0);
    })();

    // Create the node material
    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = colorNode;

    // Return material and uniforms for external updates
    return {
        material,
        uniforms: {
            uTime,
            uColorA,
            uColorB,
            uColorC,
            uMoonDirection,
            uFogColor,
            uFogNear,
            uFogFar,
            uWormHeadX,
            uWormHeadZ,
            uWormPathBaseX,
            uWormPathSlope,
            uEnhance,
        },
        // Update method for animation loop
        update(time, wormState, enhance = 0) {
            uTime.value = time;
            uEnhance.value = enhance;
            if (wormState) {
                uWormHeadX.value = wormState.headX;
                uWormHeadZ.value = wormState.headZ;
                uWormPathBaseX.value = wormState.pathBaseX;
                uWormPathSlope.value = wormState.pathSlope;
            }
        },
    };
}

// ============== SKY MATERIAL ==============

/**
 * Creates a TSL-based Arrakis sky material with gradient and moon glow
 */
export function createSkyMaterial(params) {
    const {
        topColor,
        midColor,
        bottomColor,
        horizonColor,
        moonPosition,
        moonColor,
        moonGlowIntensity,
    } = params;

    const uTopColor = uniform(topColor);
    const uMidColor = uniform(midColor);
    const uBottomColor = uniform(bottomColor);
    const uHorizonColor = uniform(horizonColor);
    const uMoonPosition = uniform(moonPosition);
    const uMoonColor = uniform(moonColor);
    const uMoonGlowIntensity = uniform(moonGlowIntensity);

    const colorNode = Fn(() => {
        const worldPos = positionWorld;
        const height = normalize(worldPos).y;

        // Multi-stop gradient for Arrakis sky
        const color = vec3(0, 0, 0).toVar();

        // High sky (above 0.3)
        const highSky = height.greaterThan(0.3);
        If(highSky, () => {
            const t = height.sub(0.3).div(0.7);
            color.assign(mix(uMidColor, uTopColor, pow(t, 0.5)));
        });

        // Mid sky (0.0 to 0.3)
        const midSky = height.greaterThan(0.0).and(height.lessThanEqual(0.3));
        If(midSky, () => {
            const t = height.div(0.3);
            color.assign(mix(uBottomColor, uMidColor, t));
        });

        // Low sky (below 0.0)
        const lowSky = height.lessThanEqual(0.0);
        If(lowSky, () => {
            const t = clamp(height.mul(-2.0), 0.0, 1.0);
            color.assign(mix(uBottomColor, uHorizonColor, t.mul(0.7)));
        });

        // Primary moon glow
        const moonDir = normalize(uMoonPosition);
        const viewDir = normalize(worldPos);
        const moonFactor = max(0.0, dot(viewDir, moonDir));
        const moonGlow = pow(moonFactor, 6.0).mul(0.5).add(pow(moonFactor, 24.0).mul(0.4));

        // Secondary moon glow
        const moon2Dir = normalize(vec3(100.0, 55.0, -180.0));
        const moon2Factor = max(0.0, dot(viewDir, moon2Dir));
        const moon2Glow = pow(moon2Factor, 8.0).mul(0.3).add(pow(moon2Factor, 32.0).mul(0.2));

        const totalGlow = moonGlow.add(moon2Glow.mul(0.35)).mul(uMoonGlowIntensity.mul(0.55));
        color.assign(mix(color, uMoonColor, totalGlow));

        return vec4(color, 1.0);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = colorNode;
    material.side = THREE.BackSide;
    material.depthWrite = false;

    return {
        material,
        uniforms: {
            uTopColor,
            uMidColor,
            uBottomColor,
            uHorizonColor,
            uMoonPosition,
            uMoonColor,
            uMoonGlowIntensity,
        },
    };
}

// ============== STARS MATERIAL ==============

/**
 * Creates a TSL-based twinkling stars material
 */
export function createStarsMaterial() {
    const uTime = uniform(0);

    const aSize = attribute('aSize');
    const aPhase = attribute('aPhase');
    const aColor = attribute('aColor');

    // Twinkle calculation
    const twinkle = sin(uTime.mul(2.0).add(aPhase.mul(10.0))).mul(0.5).add(0.5);

    const material = new THREE.PointsNodeMaterial();
    material.colorNode = vec4(aColor.mul(twinkle), twinkle);
    material.sizeNode = aSize.mul(twinkle.mul(0.5).add(0.5));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: { uTime },
        update(time) {
            uTime.value = time;
        },
    };
}

// ============== SPICE PARTICLES MATERIAL ==============

/**
 * Creates a TSL-based spice particle material
 * Supports both GPU compute (WebGPU) and CPU fallback (WebGL) paths
 *
 * @param {Object} params - Material parameters
 * @param {boolean} params.isWebGPU - Whether using WebGPU backend
 * @param {SpiceParticleCompute} params.spiceCompute - Compute instance (optional)
 */
export function createSpiceMaterial(params = {}) {
    const { isWebGPU = false, spiceCompute = null } = params;

    const uTime = uniform(0);
    const uWindStrength = uniform(0.5);
    const uSpiceIntensity = uniform(1.0);

    // Attributes from geometry
    const aPhase = attribute('aPhase');
    const aSize = attribute('aSize');
    const aColor = attribute('aColor');

    const useGPUPositions = Boolean(isWebGPU && spiceCompute?.getPositionBuffer);
    const spicePositions = useGPUPositions
        ? storage(spiceCompute.getPositionBuffer(), 'vec4', spiceCompute.count)
        : null;

    // For WebGPU: read positions from storage buffer via vertexIndex
    // For WebGL: use geometry position attribute updated on CPU
    const positionNode = Fn(() => {
        if (useGPUPositions) {
            const idx = vertexIndex;
            const pos = spicePositions.element(idx).xyz;
            return pos;
        }
        return positionLocal;
    })();

    // Glow calculation based on phase
    const glow = sin(uTime.mul(2.5).add(aPhase.mul(6.28))).mul(0.3).add(0.5);
    const glowBoost = sin(uTime.mul(4.0).add(aPhase.mul(3.14))).mul(0.2);
    const totalGlow = glow.add(glowBoost).mul(uSpiceIntensity);

    // Color with bright core
    const coreColor = vec3(1.0, 0.85, 0.6);
    const finalColor = mix(aColor, coreColor, totalGlow.mul(0.5));

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec4(finalColor.mul(1.5), totalGlow.mul(0.85));
    material.sizeNode = aSize.mul(totalGlow).mul(uSpiceIntensity);
    material.emissiveNode = finalColor.mul(totalGlow).mul(1.5);
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: { uTime, uWindStrength, uSpiceIntensity },
        update(time, windStrength, spiceIntensity) {
            uTime.value = time;
            if (windStrength !== undefined) uWindStrength.value = windStrength;
            if (spiceIntensity !== undefined) uSpiceIntensity.value = spiceIntensity;
        },
    };
}

// ============== SAND SMOKE MATERIAL ==============

/**
 * Creates a TSL-based sand smoke material with compute-driven positions
 *
 * @param {Object} params - Material parameters
 * @param {THREE.Color} params.color - Smoke color
 * @param {boolean} params.isWebGPU - Whether using WebGPU backend
 * @param {SandSmokeCompute} params.sandSmokeCompute - Compute instance (optional)
 */
/**
 * Creates a TSL-based sand smoke material with compute-driven positions
 *
 * @param {Object} params - Material parameters
 * @param {THREE.Color} params.color - Smoke color
 * @param {boolean} params.isWebGPU - Whether using WebGPU backend
 * @param {SandSmokeCompute} params.sandSmokeCompute - Compute instance (optional)
 */
export function createSandSmokeMaterial(params = {}) {
    const {
        color = new THREE.Color(0xc4a35a),
        isWebGPU = false,
        sandSmokeCompute = null,
        opacity = 0.35,
    } = params;

    const uTime = uniform(0);
    const uOpacity = uniform(opacity);
    const uColor = uniform(color);

    const useGPU = Boolean(isWebGPU && sandSmokeCompute?.getStateBuffer);

    if (useGPU) {
        // WebGPU path: Instanced camera-facing quads (billboards).
        // Read compute state in vertex stage and pass color/alpha through varyings.
        const smokeState = storage(sandSmokeCompute.getStateBuffer(), 'vec4', sandSmokeCompute.count * 2);
        const vSmokeColor = varying(vec3(0), 'vSmokeColor');
        const vSmokeAlpha = varying(float(0), 'vSmokeAlpha');
        const vSmokeRand = varying(float(0), 'vSmokeRand');
        const vSmokeAge = varying(float(0), 'vSmokeAge');
        const vFlowDir = varying(vec2(0), 'vFlowDir');
        const vFlowSpeed = varying(float(0), 'vFlowSpeed');
        const vHeightLerp = varying(float(0), 'vHeightLerp');

        const positionNode = Fn(() => {
            const index = instanceIndex;
            const posLife = smokeState.element(index.mul(2));
            const velRand = smokeState.element(index.mul(2).add(1));

            const center = posLife.xyz;
            const life = posLife.w;
            const rand = velRand.w;
            const age = float(1.0).sub(life);

            // Head plumes are massive and expand fast (explosive eruption).
            // Wake dust is medium-sized and broader (long flat plume along ground).
            const isWake = step(float(0.42), rand);
            const headBase = float(58.0).add(rand.mul(46.0));
            const wakeBase = float(72.0).add(rand.mul(48.0));
            const sizeBase = mix(headBase, wakeBase, isWake);
            const headExpand = float(96.0);
            const wakeExpand = float(70.0);
            const expansion = age.mul(mix(headExpand, wakeExpand, isWake));
            const finalSize = sizeBase.add(expansion);

            // Stable billboard basis, including near-vertical camera rays.
            const toCameraVec = cameraPosition.sub(center);
            const toCamera = toCameraVec.div(max(length(toCameraVec), float(0.0001)));
            const worldUp = vec3(0.0, 1.0, 0.0);
            const altUp = vec3(1.0, 0.0, 0.0);
            const upBlend = smoothstep(0.97, 0.995, abs(dot(toCamera, worldUp)));
            const billboardUp = normalize(mix(worldUp, altUp, upBlend));
            const rightVec = cross(billboardUp, toCamera);
            const right = rightVec.div(max(length(rightVec), float(0.0001)));
            const upVec = cross(toCamera, right);
            const up = upVec.div(max(length(upVec), float(0.0001)));

            // Stretch billboard along projected velocity for windy dune-dust streaks.
            const velocity = velRand.xyz;
            const speed = length(velocity);
            const speedNorm = clamp(speed.div(28.0), 0.0, 1.0);
            const velInBillboard = vec2(dot(velocity, right), dot(velocity, up));
            const velLen = max(length(velInBillboard), float(0.0001));
            const velDir = velInBillboard.div(velLen);
            const dirBlend = smoothstep(0.8, 7.0, speed);
            const flowDir = normalize(mix(vec2(1.0, 0.0), velDir, dirBlend));
            const flowPerp = vec2(flowDir.y.negate(), flowDir.x);

            const localXY = positionLocal.xy;
            const along = dot(localXY, flowDir);
            const across = dot(localXY, flowPerp);

            const stretch = mix(float(1.0), float(2.2), speedNorm).mul(mix(float(1.0), float(1.3), age));
            const spread = mix(float(1.0), float(0.78), speedNorm);
            const rotatedX = along.mul(stretch);
            const rotatedY = across.mul(spread);

            const worldOffset = right.mul(rotatedX).add(up.mul(rotatedY)).mul(finalSize);
            const cloudPos = center.add(worldOffset);

            const fadeIn = smoothstep(0.0, 0.03, age);
            const fadeOut = smoothstep(0.0, 0.25, life);
            const density = mix(float(1.15), float(0.38), age);
            const deadMask = step(0.001, life);
            const camDist = length(cameraPosition.sub(center));
            const nearFade = smoothstep(6.0, 64.0, camDist);
            const distFade = float(1.0).sub(smoothstep(1200.0, 1950.0, camDist));
            const alpha = uOpacity.mul(fadeIn).mul(fadeOut).mul(density).mul(deadMask)
                .mul(distFade)
                .mul(nearFade);

            const colorVar = mix(float(0.85), float(1.15), rand);
            vSmokeColor.assign(uColor.mul(colorVar));
            vSmokeAlpha.assign(alpha);
            vSmokeRand.assign(rand);
            vSmokeAge.assign(age);
            vFlowDir.assign(flowDir);
            vFlowSpeed.assign(speedNorm);
            vHeightLerp.assign(smoothstep(-8.0, 64.0, center.y));

            return cloudPos;
        })();

        // Break up the underlying quad so smoke reads as cinematic volumetric dust.
        const smokeUV = uv();
        const centeredUV = smokeUV.sub(vec2(0.5, 0.5));
        const flowOffset = vFlowDir.mul(uTime.mul(0.032).mul(mix(0.28, 0.92, vFlowSpeed)));
        const domainUV = smokeUV.add(flowOffset).add(vec2(vSmokeRand.mul(0.23), vSmokeRand.mul(0.17)));

        const edgeNoiseA = hash2D(domainUV.mul(14.0).add(vec2(vSmokeRand.mul(37.0), uTime.mul(0.07))));
        const radialA = length(centeredUV);
        const contourA = radialA.add(edgeNoiseA.sub(0.5).mul(0.22));
        const lobeA = float(1.0).sub(smoothstep(0.10, 0.53, contourA));

        const lobeShift = vFlowDir.mul(0.18).add(vec2(vSmokeRand.sub(0.5).mul(0.10), sin(uTime.mul(0.05).add(vSmokeRand.mul(6.28))).mul(0.05)));
        const radialB = length(centeredUV.sub(lobeShift));
        const edgeNoiseB = hash2D(domainUV.mul(18.0).add(vec2(vSmokeRand.mul(61.0), uTime.mul(-0.06))));
        const contourB = radialB.add(edgeNoiseB.sub(0.5).mul(0.26));
        const lobeB = float(1.0).sub(smoothstep(0.05, 0.41, contourB));

        const softShape = max(lobeA.mul(0.82), lobeB.mul(0.72));

        const detailA = hash2D(domainUV.mul(9.0).add(vec2(vSmokeRand.mul(19.0), uTime.mul(0.04))));
        const detailB = hash2D(domainUV.mul(26.0).add(vec2(vSmokeRand.mul(53.0), uTime.mul(-0.05))));
        const detailC = hash2D(domainUV.mul(38.0).add(vec2(vSmokeRand.mul(73.0), uTime.mul(0.09))));
        const wisps = mix(float(0.48), float(0.98), detailA.mul(0.45).add(detailB.mul(0.35)).add(detailC.mul(0.2)));
        const ageSoftness = mix(float(1.0), float(0.74), vSmokeAge);
        const heightDensity = mix(float(1.06), float(0.52), vHeightLerp);
        const flowAxis = dot(centeredUV, vFlowDir);
        const plumeBias = smoothstep(-0.42, 0.58, flowAxis);
        const plumeBody = mix(float(0.75), float(1.08), plumeBias);
        const shapeAlpha = softShape.mul(wisps).mul(ageSoftness).mul(heightDensity).mul(plumeBody);

        const rim = smoothstep(0.26, 0.62, radialA);
        const innerLift = float(1.0).sub(smoothstep(0.0, 0.34, radialA)).mul(0.10);
        const warmEdge = vec3(1.02, 0.94, 0.82);
        const denseCore = vec3(0.82, 0.74, 0.62);
        const tonal = mix(denseCore, warmEdge, rim);
        const ageTone = mix(vec3(1.0, 0.98, 0.96), vec3(0.84, 0.82, 0.80), vSmokeAge);
        const shadedColor = vSmokeColor.mul(tonal).mul(ageTone).mul(float(0.9).add(innerLift));

        const material = new THREE.MeshBasicNodeMaterial();
        material.positionNode = positionNode;
        material.colorNode = shadedColor;
        material.opacityNode = vSmokeAlpha.mul(shapeAlpha);
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.NormalBlending;
        material.side = THREE.FrontSide;
        material.alphaTest = 0.002;

        return {
            material,
            uniforms: { uTime, uOpacity, uColor },
            update(time, newOpacity) {
                uTime.value = time;
                if (newOpacity !== undefined) uOpacity.value = newOpacity;
            },
        };
    }

    // WebGL fallback: points with per-vertex attributes
    // Attributes must be set up in the theme to match: aLife, aRand
    const aLife = attribute('aLife');
    const aRand = attribute('aRand');

    const positionNode = Fn(() => positionLocal)();

    // Opacity based on life (fade in quickly, fade out slowly)
    const ageGL = float(1.0).sub(aLife);
    const fadeIn = smoothstep(0.0, 0.08, ageGL); // ramp up over first 8% of life
    const fadeOut = smoothstep(0.0, 0.3, aLife); // fade out over last 30%
    const alpha = uOpacity.mul(fadeIn).mul(fadeOut);

    const smokeBase = mix(uColor, uColor.mul(0.6), aRand);

    // Size expansion — large billowing clouds
    const sizeBase = float(55.0).add(aRand.mul(40.0));
    const expansion = ageGL.mul(95.0);
    const sizeNode = sizeBase.add(expansion);

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec4(smokeBase, alpha);
    material.sizeNode = sizeNode;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.alphaTest = 0.01;
    // Normalize size for Points vs Sprite differences (Points are screen space pixels usually, unless sizeAttenuation)
    material.sizeAttenuation = true;

    return {
        material,
        uniforms: { uTime, uOpacity, uColor },
        update(time, newOpacity) {
            uTime.value = time;
            if (newOpacity !== undefined) uOpacity.value = newOpacity;
        },
    };
}

// ============== BLUE GLOW OVERLAY MATERIAL ==============

/**
 * Creates a TSL-based fullscreen blue glow overlay
 */
export function createBlueGlowMaterial(params = {}) {
    const { intensity = 0 } = params;
    const uIntensity = uniform(intensity);
    const uTime = uniform(0);

    const uvNode = vec2(positionLocal.x, positionLocal.y).mul(0.5).add(0.5);
    const center = uvNode.sub(vec2(0.5, 0.5));
    const dist = length(center);
    const vignette = smoothstep(0.2, 0.7, dist);

    const pulse = sin(uTime.mul(4.0)).mul(0.5).add(0.5);
    const deepBlue = vec3(0.05, 0.15, 0.5);
    const spiceBlue = vec3(0.1, 0.3, 0.8);
    const blueColor = mix(deepBlue, spiceBlue, pulse);

    const alpha = uIntensity.mul(vignette).mul(0.4);

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec4(blueColor, alpha);
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;

    return {
        material,
        uniforms: { uIntensity, uTime },
        update(time, intensityValue) {
            uTime.value = time;
            if (intensityValue !== undefined) uIntensity.value = intensityValue;
        },
    };
}
