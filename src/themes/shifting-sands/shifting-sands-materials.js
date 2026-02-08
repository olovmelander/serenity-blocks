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
        dot(p, vec3(113.5, 271.9, 124.6))
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
        u.z
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
        const headMask = smoothstep(260.0, 0.0, abs(distFromHead));

        // Ridge parameters
        const ridgeLength = float(150.0);
        const wakeLength = float(300.0);

        // Calculate ridge displacement
        const ridgeDisplacement = float(0).toVar();

        // Main ridge (ahead of head)
        const inRidge = distFromHead.greaterThan(0.0).and(distFromHead.lessThan(ridgeLength));
        If(inRidge, () => {
            const ridgeProgress = distFromHead.div(ridgeLength);
            ridgeDisplacement.assign(sin(ridgeProgress.mul(3.14159)).mul(24.0));
        });

        // Wake behind head
        const inWake = distFromHead.greaterThanEqual(wakeLength.negate()).and(distFromHead.lessThanEqual(0.0));
        If(inWake, () => {
            const wakeProgress = distFromHead.negate().div(wakeLength);
            const wakeDisp = float(1.0).sub(wakeProgress).mul(sin(wakeProgress.mul(4.0).add(uTime.mul(1.5)))).mul(8.0);
            ridgeDisplacement.assign(wakeDisp);
        });

        // Apply worm displacement
        const wormMask = pathMask.mul(headMask);
        pos.y.addAssign(ridgeDisplacement.mul(wormMask));
        wormEffect.assign(wormMask.mul(step(0.5, ridgeDisplacement).mul(0.7).add(0.3)));

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
            uTime.mul(0.01)
        ));

        const n1 = noise3D(ripplePos.add(vec3(0.0, 0.0, uTime.mul(0.015))));
        const n2 = noise3D(ripplePos.mul(2.5).add(vec3(5.2, 1.3, uTime.mul(-0.01))));

        // Perturb normal based on ripples
        const rippleIntensity = float(0.2);
        const disturbedNormal = normalize(normal.add(vec3(
            n1.add(windRipple.mul(0.5)),
            0.0,
            n2
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
            1.0
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
            0.35
        );
        finalColor.assign(mix(finalColor, dustColor, dustIntensity.mul(step(0.12, vWormTrail))));

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
        // WebGPU path: instanced sprites with storage buffer positions/sizes
        const smokeState = storage(sandSmokeCompute.getStateBuffer(), 'vec4', sandSmokeCompute.count * 2);
        const pos = smokeState.element(instanceIndex.mul(2)).xyz;
        const props = smokeState.element(instanceIndex.mul(2).add(1));

        const rand = props.x;
        const wormIntensity = clamp(props.y.mul(1.4), 0.0, 1.0);
        const trailFade = props.z;
        const sizeNode = props.w;

        const baseAlpha = rand.mul(0.045).add(0.03).mul(uOpacity);
        const wormBoost = wormIntensity.mul(0.6).mul(trailFade);
        const alpha = clamp(baseAlpha.add(wormBoost), 0.0, 0.7);

        const smokeBase = mix(uColor.mul(0.45), uColor.mul(0.82), rand);
        const smokeColor = mix(smokeBase, uColor.mul(0.92), wormIntensity.mul(0.35));
        const sizeScale = float(0.06);
        const spriteScale = vec2(sizeNode.mul(sizeScale).mul(wormIntensity.mul(0.55).add(0.4)));

        // Soft radial mask to avoid square sprites
        const localUV = vec2(positionLocal.x, positionLocal.y).add(0.5);
        const mask = smoothstep(0.5, 0.1, length(localUV.sub(vec2(0.5))));

        // Distance-based fade to avoid screen takeover
        const dist = length(cameraPosition.sub(positionWorld));
        const distFade = smoothstep(900.0, 250.0, dist);

        const material = new THREE.SpriteNodeMaterial();
        material.positionNode = pos;
        material.scaleNode = spriteScale;
        material.colorNode = vec4(smokeColor, alpha.mul(mask).mul(distFade));
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.NormalBlending;

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
    const aSize = attribute('aSize');
    const aRandom = attribute('aRandom');
    const aWorm = attribute('aWorm');

    const positionNode = Fn(() => positionLocal)();

    const rand = aRandom;
    const wormIntensity = clamp(aWorm.mul(1.1), 0.0, 1.0);
    const sizeNode = aSize;

    // Revert to original logic with boosted visibility
    const baseAlpha = rand.mul(0.12).add(0.15).mul(uOpacity);
    const wormBoost = wormIntensity.mul(0.55);
    const alpha = clamp(baseAlpha.add(wormBoost), 0.0, 0.75);

    const smokeBase = mix(uColor.mul(0.55), uColor.mul(0.85), rand);
    const smokeColor = mix(smokeBase, uColor.mul(0.95), wormIntensity.mul(0.3));

    const material = new THREE.PointsNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec4(smokeColor, alpha);
    material.sizeNode = sizeNode.mul(wormIntensity.mul(0.45).add(0.55));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;

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
