import * as THREE from 'three/webgpu';
import {
    Fn,
    attribute,
    storage,
    uniform,
    uv,
    vec2,
    vec3,
    float,
    sin,
    mix,
    smoothstep,
    fract,
    abs,
    length,
    step,
    pow,
    max,
    min,
    clamp,
    positionWorld,
    positionLocal,
    normalWorld,
    cameraPosition,
    positionView,
    vertexColor,
    normalize,
    dot,
    vertexIndex,
    instanceIndex,
    screenUV,
    viewportSharedTexture,
} from 'three/tsl';

// ============================================================================
// GRID MATERIAL (Synthwave Grid)
// ============================================================================

export function createGridNodeMaterial(colors, params = {}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const uTime = uniform(0);
    const uSpeed = uniform(params.gridScrollSpeed ?? 10.0);
    const uGridColor = uniform(colors.gridColor);
    const uGlowIntensity = uniform(1.0);
    const uPulseIntensity = uniform(0);
    const uColorShift = uniform(colors.gridGlow);
    const uSunPosition = uniform(new THREE.Vector3(0, 50, -900));
    const uWaveTime = uniform(0);
    const uWaveOrigin = uniform(new THREE.Vector2(0, 0));
    const uWaveIntensity = uniform(0);
    const uSSRStrength = uniform(params.ssrStrength ?? 0.45);

    const gridSpacing = float(6.0);
    const lineWidth = float(0.08);

    const baseWorld = positionWorld;
    const distToWave = length(baseWorld.xz.sub(uWaveOrigin));
    const waveFade = float(1.0).sub(smoothstep(float(0.0), float(140.0), distToWave));
    const waveHeight = sin(distToWave.mul(0.35).sub(uWaveTime.mul(4.0)))
        .mul(waveFade)
        .mul(uWaveIntensity)
        .mul(1.8);
    const worldPos = baseWorld.add(vec3(0.0, waveHeight, 0.0));
    material.positionNode = positionLocal.add(vec3(0.0, waveHeight, 0.0));

    const scrolledZ = worldPos.z.sub(uTime.mul(uSpeed));

    const gridX = abs(fract(worldPos.x.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);
    const gridZ = abs(fract(scrolledZ.div(gridSpacing).add(0.5)).sub(0.5)).mul(gridSpacing);

    const dist = length(vec2(worldPos.x, worldPos.z));
    const distFactor = smoothstep(float(20.0), float(100.0), dist);
    const thicknessMod = float(1.0).add(distFactor.mul(6.0));

    const modLineWidth = lineWidth.mul(2.5).mul(thicknessMod);
    const lineX = smoothstep(modLineWidth, float(0.0), gridX);
    const lineZ = smoothstep(modLineWidth, float(0.0), gridZ);
    const gridLine = max(lineX, lineZ);

    const distanceFade = float(1.0).sub(smoothstep(float(10.0), float(80.0), dist));
    const perspectiveFade = float(1.0).sub(smoothstep(float(0.0), float(200.0), worldPos.z.negate()));

    const sunX = uSunPosition.x;
    const sunWidth = float(100.0);
    const pathDist = abs(worldPos.x.sub(sunX));
    const reflection = pow(
        float(1.0).sub(smoothstep(float(0.0), sunWidth, pathDist)),
        float(2.0),
    ).mul(0.5);

    const baseGridColor = mix(uGridColor, uColorShift, uPulseIntensity.mul(0.5));
    const reflectionColor = vec3(1.0, 0.5, 0.8);

    let finalColor = baseGridColor.mul(gridLine);
    const horizonFade = smoothstep(float(200.0), float(50.0), dist);
    finalColor = finalColor.add(reflectionColor.mul(reflection).mul(0.6).mul(horizonFade));

    if (params.enableSSR) {
        const baseUV = vec2(screenUV.x, float(1.0).sub(screenUV.y));
        const ripple = sin(worldPos.x.mul(0.05).add(uTime.mul(0.6)))
            .add(sin(worldPos.z.mul(0.04).sub(uTime.mul(0.4))))
            .mul(0.004);
        const distortedUV = baseUV.add(vec2(ripple, ripple));
        const ssrSample = viewportSharedTexture(distortedUV).xyz;
        const viewDir = normalize(cameraPosition.sub(worldPos));
        const fresnel = pow(float(1.0).sub(dot(normalWorld, viewDir)), float(3.0));
        const ssrMask = fresnel.mul(horizonFade).mul(uSSRStrength);
        finalColor = finalColor.add(ssrSample.mul(ssrMask));
    }

    const intensity = gridLine.mul(uGlowIntensity).add(reflection.mul(0.4));
    const alpha = intensity.mul(distanceFade).mul(perspectiveFade);

    material.colorNode = finalColor;
    material.opacityNode = min(alpha, float(1.0));
    material.emissiveNode = finalColor.mul(alpha);
    material.userData = {
        uTime,
        uSpeed,
        uGridColor,
        uGlowIntensity,
        uPulseIntensity,
        uColorShift,
        uSunPosition,
        uWaveTime,
        uWaveOrigin,
        uWaveIntensity,
        uSSRStrength,
    };

    return material;
}

// ============================================================================
// SUN MATERIAL (Retro Stripes)
// ============================================================================

export function createSunNodeMaterial(colors) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        side: THREE.FrontSide,
        depthWrite: false,
    });

    const uTime = uniform(0);
    const uColorTop = uniform(colors.sunTop);
    const uColorMid = uniform(colors.sunMid);
    const uColorBottom = uniform(colors.sunBottom);
    const uPulseIntensity = uniform(0);
    const uStripeCount = uniform(8.0);

    const uvCoord = uv();
    const y = uvCoord.y;

    const lowMix = mix(uColorBottom, uColorMid, y.mul(2.0));
    const highMix = mix(uColorMid, uColorTop, y.sub(0.5).mul(2.0));
    const baseColor = mix(lowMix, highMix, step(float(0.5), y));

    const stripePhase = pow(float(1.0).sub(y), float(2.5)).mul(uStripeCount).mul(3.0);
    const pattern = fract(stripePhase);
    const stripe = step(float(0.5), pattern);
    const blend = smoothstep(float(0.5), float(0.6), y);
    const stripeAlpha = mix(stripe, float(1.0), blend);

    const normal = normalWorld;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normal, viewDir), float(0.0))), float(3.0));

    let finalColor = baseColor;
    finalColor = finalColor.add(finalColor.mul(uPulseIntensity).mul(0.4));
    finalColor = finalColor.add(vec3(1.0, 0.8, 0.5).mul(fresnel).mul(0.5));

    material.colorNode = finalColor;
    material.opacityNode = mix(stripeAlpha, float(1.0), step(float(0.6), y));
    material.emissiveNode = finalColor.mul(float(0.85));
    material.userData = {
        uTime,
        uColorTop,
        uColorMid,
        uColorBottom,
        uPulseIntensity,
        uStripeCount,
    };

    return material;
}

// ============================================================================
// SUN GLOW MATERIAL
// ============================================================================

export function createSunGlowNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const uGlowColor = uniform(params.color ?? new THREE.Color(0xff6688));
    const uOpacity = uniform(params.opacity ?? 0.4);
    const uPulseIntensity = uniform(0);

    const center = uv().sub(0.5);
    const dist = length(center).mul(2.0);
    let glow = float(1.0).sub(smoothstep(float(0.0), float(1.0), dist));
    glow = pow(glow, float(2.0));
    glow = glow.add(glow.mul(uPulseIntensity).mul(0.3));

    material.colorNode = uGlowColor;
    material.opacityNode = glow.mul(uOpacity);
    material.emissiveNode = uGlowColor.mul(glow.mul(uOpacity));
    material.userData = {
        uGlowColor,
        uOpacity,
        uPulseIntensity,
    };

    return material;
}

// ============================================================================
// STAR MATERIAL
// ============================================================================

export function createStarNodeMaterial(params = {}) {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.vertexColors = true;

    const usePointSprite = Boolean(params.usePointSprite && !params.isWebGPU);

    const uTime = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1);
    const uEventBoost = uniform(0);

    const useGPU = Boolean(params.isWebGPU && params.starCompute?.getStateBuffer);
    const starState = useGPU
        ? storage(params.starCompute.getStateBuffer(), 'vec4', params.starCompute.count)
        : null;

    const aSize = attribute('aSize');
    const aTwinkle = attribute('aTwinkle', 'vec2');
    const aBrightness = attribute('aBrightness');

    const phase = useGPU ? starState.element(vertexIndex).x : aTwinkle.x;
    const speed = useGPU ? starState.element(vertexIndex).y : aTwinkle.y;
    const baseBrightness = useGPU ? starState.element(vertexIndex).z : aBrightness;
    const sizeValue = useGPU ? starState.element(vertexIndex).w : aSize;

    const twinkle = useGPU ? sin(phase) : sin(uTime.mul(speed).add(phase));
    const brightness = baseBrightness.mul(float(0.6).add(twinkle.mul(0.4))).mul(
        float(1.0).add(uEventBoost.mul(0.5)),
    );

    const sizeNode = sizeValue
        .mul(uPixelRatio)
        .mul(float(150.0).div(positionView.z.negate()));
    material.sizeNode = clamp(sizeNode, float(0.5), float(25.0));

    const softCircle = usePointSprite
        ? pow(
            float(1.0).sub(
                smoothstep(
                    float(0.0),
                    float(1.0),
                    length(uv().sub(0.5)).mul(2.0),
                ),
            ),
            float(2.0),
        )
        : float(1.0);

    const alpha = softCircle.mul(brightness).mul(0.7);
    const color = vertexColor().mul(brightness).mul(0.8);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);
    material.userData = { uTime, uPixelRatio, uEventBoost };

    return material;
}

// ============================================================================
// MOUNTAIN MATERIAL (Simplified Noise + Rim Lighting)
// ============================================================================

export function createMountainNodeMaterial(colors, layer = 0) {
    const material = new THREE.MeshBasicNodeMaterial({ transparent: false });

    const uBaseColor = uniform(colors.mountainDark);
    const uRimColor = uniform(colors.mountainRim);
    const uMountainLayer = uniform(layer);
    const uTime = uniform(0);
    const uRimIntensity = uniform(1.0);
    const uShockwave = uniform(0);

    const height = positionLocal.y;
    const heightFactor = smoothstep(float(0.0), float(150.0), height);
    const detailColor = mix(uBaseColor, uRimColor.mul(0.3), heightFactor);

    const noiseCoord = positionWorld.xz.mul(0.02);
    const noiseVal = sin(dot(noiseCoord, vec2(12.9898, 78.233))).mul(43758.5453);
    const noise = fract(noiseVal).sub(0.5).mul(2.0);

    let color = detailColor.add(uRimColor.mul(max(float(0.0), noise)).mul(0.1).mul(heightFactor));

    const normal = normalWorld;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fresnel = pow(float(1.0).sub(max(dot(normal, viewDir), float(0.0))), float(3.0));
    const topLight = smoothstep(float(40.0), float(150.0), height);
    const shockwave = sin(positionWorld.z.mul(0.08).sub(uTime.mul(2.0)))
        .mul(uShockwave)
        .mul(0.6)
        .add(1.0);
    const rim = uRimColor.mul(fresnel).mul(topLight).mul(2.5).mul(uRimIntensity)
        .mul(shockwave);

    const groundFog = float(1.0).sub(smoothstep(float(-10.0), float(80.0), height));
    const fogColor = vec3(0.02, 0.0, 0.05);
    color = mix(color, fogColor, groundFog.mul(0.9));
    color = color.add(rim.mul(float(1.0).sub(groundFog.mul(0.6))));

    const dist = length(positionWorld.xz);
    const fogFactor = smoothstep(float(200.0), float(900.0), dist);
    const hazeColor = vec3(0.1, 0.05, 0.2);
    color = mix(color, hazeColor, fogFactor.mul(0.7));

    material.colorNode = color;
    material.userData = {
        uBaseColor, uRimColor, uMountainLayer, uTime, uRimIntensity, uShockwave,
    };

    return material;
}

// ============================================================================
// GRID HIGHLIGHT MATERIAL
// ============================================================================

export function createHighlightNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.side = THREE.DoubleSide;

    const uColor = uniform(new THREE.Color(0x00ffff));
    const uIntensity = uniform(0);
    const uTime = uniform(0);
    const uTwinkle = uniform(0);
    const useInstancing = params.useInstancing === true;

    const useGPU = Boolean(
        params.isWebGPU && params.highlightCompute?.getStateBuffer && params.highlightCompute?.getColorBuffer,
    );
    const stateBuffer = useGPU
        ? storage(params.highlightCompute.getStateBuffer(), 'vec4', params.highlightCompute.count)
        : null;
    const colorBuffer = useGPU
        ? storage(params.highlightCompute.getColorBuffer(), 'vec4', params.highlightCompute.count)
        : null;

    const basePos = Fn(() => {
        if (useGPU) {
            return stateBuffer.element(instanceIndex).xyz;
        }
        return vec3(0.0, 0.0, 0.0);
    })();

    const baseIntensity = Fn(() => {
        if (useGPU) {
            return stateBuffer.element(instanceIndex).w;
        }
        if (useInstancing) {
            return attribute('aIntensity');
        }
        return uIntensity;
    })();

    const baseColor = Fn(() => {
        if (useGPU) {
            return colorBuffer.element(instanceIndex).xyz;
        }
        if (useInstancing) {
            return attribute('aColor');
        }
        return uColor;
    })();

    const phase = Fn(() => {
        if (useGPU) {
            return colorBuffer.element(instanceIndex).w;
        }
        return float(0.0);
    })();

    material.positionNode = useGPU ? positionLocal.add(basePos) : positionLocal;

    const uvCoord = uv();
    const center = uvCoord.sub(0.5);
    const edge = max(abs(center.x), abs(center.y));
    const edgeGlow = smoothstep(float(0.35), float(0.5), edge);
    const fill = float(1.0).sub(smoothstep(float(0.0), float(0.4), edge));

    const pulse = sin(uTime.mul(3.0)).mul(0.1).add(1.0);
    const twinkle = sin(uTime.mul(15.0).add(phase)).mul(uTwinkle).mul(0.3).add(1.0);

    const fadeStart = float(100.0);
    const fadeRange = float(200.0);
    const fadeZ = useGPU ? basePos.z : positionWorld.z;
    const distanceFade = max(
        float(0.3),
        float(1.0).sub(max(float(0.0), fadeZ.sub(fadeStart)).div(fadeRange)),
    );

    const intensity = baseIntensity.mul(pulse).mul(twinkle).mul(distanceFade);

    const chromatic = baseColor.add(vec3(0.3, 0.0, 0.2).mul(edgeGlow));
    const finalColor = chromatic.mul(intensity);
    const alpha = fill.mul(0.5).add(edgeGlow.mul(0.9)).mul(intensity);

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.emissiveNode = finalColor.mul(alpha);
    material.userData = {
        uColor, uIntensity, uTime, uTwinkle,
    };

    return material;
}

// ============================================================================
// PARTICLE MATERIAL (Burst + Ambient)
// ============================================================================

export function createParticleNodeMaterial(params = {}) {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.vertexColors = true;

    const usePointSprite = Boolean(params.usePointSprite && !params.isWebGPU);

    const uTime = uniform(0);
    const uPixelRatio = uniform(params.pixelRatio ?? 1);
    const uTwinkle = uniform(0);
    const uColorShift = uniform(params.colorShift ?? 0);
    const enableColorShift = Boolean(params.enableColorShift);

    const useGPU = Boolean(
        params.isWebGPU && params.particleCompute?.getStateBuffer && params.particleCompute?.getColorBuffer,
    );
    const stateBuffer = useGPU
        ? storage(params.particleCompute.getStateBuffer(), 'vec4', params.particleCompute.count * 3)
        : null;
    const colorBuffer = useGPU
        ? storage(params.particleCompute.getColorBuffer(), 'vec4', params.particleCompute.count)
        : null;

    const aSize = attribute('aSize');
    const aLife = attribute('aLife');
    const aType = attribute('aType');

    const basePos = useGPU ? stateBuffer.element(vertexIndex.mul(3)).xyz : positionLocal;
    const lifeNode = useGPU ? stateBuffer.element(vertexIndex.mul(3)).w : aLife;
    const sizeValue = useGPU ? stateBuffer.element(vertexIndex.mul(3).add(2)).x : aSize;
    const typeValue = useGPU ? stateBuffer.element(vertexIndex.mul(3).add(2)).y : aType;
    const colorValue = useGPU ? colorBuffer.element(vertexIndex).xyz : vertexColor();

    material.positionNode = basePos;

    const sizeMult = mix(float(1.0), float(1.5), step(float(1.5), typeValue));
    const sizeNode = sizeValue
        .mul(lifeNode)
        .mul(sizeMult)
        .mul(uPixelRatio)
        .mul(float(300.0).div(positionView.z.negate()));
    material.sizeNode = clamp(sizeNode, float(1.0), float(80.0));

    let alpha;
    if (usePointSprite) {
        const center = uv().sub(0.5);
        const dist = length(center);
        const circleAlpha = pow(max(float(0.0), float(1.0).sub(dist.mul(2.0))), float(1.5)).mul(
            lifeNode,
        );

        const ring = smoothstep(float(0.3), float(0.35), dist)
            .mul(smoothstep(float(0.5), float(0.45), dist))
            .mul(lifeNode);

        const squareMask = step(abs(center.x), float(0.4)).mul(step(abs(center.y), float(0.4)));
        const squareGlow = float(1.0).sub(max(abs(center.x), abs(center.y)).mul(2.0));
        const squareAlpha = max(
            squareMask.mul(0.8),
            pow(max(float(0.0), squareGlow), float(1.5)).mul(0.5),
        ).mul(lifeNode);

        const isCircle = float(1.0).sub(step(float(0.5), typeValue));
        const isRing = step(float(0.5), typeValue).sub(step(float(1.5), typeValue));
        const isSquare = step(float(1.5), typeValue);

        alpha = circleAlpha.mul(isCircle)
            .add(ring.mul(isRing))
            .add(squareAlpha.mul(isSquare));
    } else {
        alpha = lifeNode;
    }

    const twinkleBoost = float(1.0).add(uTwinkle.mul(0.1));
    let color = colorValue.mul(float(1.0).add(lifeNode.mul(0.5))).mul(twinkleBoost);
    if (enableColorShift) {
        const shiftAmount = clamp(uColorShift, float(0.0), float(1.0)).mul(0.35);
        const shiftColor = vec3(1.0, 0.25, 0.9);
        color = mix(color, shiftColor, shiftAmount);
    }
    const finalAlpha = alpha.mul(twinkleBoost);

    material.colorNode = color;
    material.opacityNode = finalAlpha;
    material.emissiveNode = color.mul(finalAlpha);
    material.userData = {
        uTime, uPixelRatio, uTwinkle, uColorShift,
    };

    return material;
}

// ============================================================================
// RETRO PIXEL MATERIAL
// ============================================================================

export function createRetroPixelNodeMaterial(params = {}) {
    const material = createParticleNodeMaterial({
        ...params,
        enableColorShift: true,
    });
    return material;
}

// ============================================================================
// RETRO PIXEL TRAIL MATERIAL
// ============================================================================

export function createPixelTrailNodeMaterial(params = {}) {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.vertexColors = true;

    const uPixelRatio = uniform(params.pixelRatio ?? 1);
    const uTwinkle = uniform(0);
    const uColorShift = uniform(params.colorShift ?? 0);
    const enableColorShift = Boolean(params.enableColorShift);

    const useGPU = Boolean(
        params.isWebGPU && params.particleCompute?.getStateBuffer && params.particleCompute?.getColorBuffer,
    );
    const stateBuffer = useGPU
        ? storage(params.particleCompute.getStateBuffer(), 'vec4', params.particleCompute.count * 3)
        : null;
    const colorBuffer = useGPU
        ? storage(params.particleCompute.getColorBuffer(), 'vec4', params.particleCompute.count)
        : null;

    const aSize = attribute('aSize');
    const aLife = attribute('aLife');

    const basePos = useGPU ? stateBuffer.element(vertexIndex.mul(3)).xyz : positionLocal;
    const vel = useGPU ? stateBuffer.element(vertexIndex.mul(3).add(1)).xyz : vec3(0.0);
    const lifeNode = useGPU ? stateBuffer.element(vertexIndex.mul(3)).w : aLife;
    const sizeValue = useGPU ? stateBuffer.element(vertexIndex.mul(3).add(2)).x : aSize;
    const colorValue = useGPU ? colorBuffer.element(vertexIndex).xyz : vertexColor();

    const trailLength = float(params.trailLength ?? 0.6);
    const trailPos = useGPU ? basePos.sub(vel.mul(trailLength)) : basePos;
    material.positionNode = trailPos;

    const sizeNode = sizeValue
        .mul(0.6)
        .mul(uPixelRatio)
        .mul(float(260.0).div(positionView.z.negate()));
    material.sizeNode = clamp(sizeNode, float(0.5), float(40.0));

    let color = colorValue.mul(float(0.8));
    if (enableColorShift) {
        const shiftAmount = clamp(uColorShift, float(0.0), float(1.0)).mul(0.3);
        const shiftColor = vec3(1.0, 0.25, 0.9);
        color = mix(color, shiftColor, shiftAmount);
    }
    const alpha = lifeNode.mul(0.35).mul(float(1.0).add(uTwinkle.mul(0.1)));

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);
    material.userData = { uPixelRatio, uTwinkle, uColorShift };

    return material;
}

// ============================================================================
// HOLOGRAM RING MATERIAL
// ============================================================================

export function createRingNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const useInstancing = params.useInstancing === true;

    const uColor = uniform(new THREE.Color(0xff00ff));
    const uLife = uniform(1.0);
    const uRadius = uniform(0.05);
    const uMaxRadius = uniform(1.0);

    const center = uv().sub(0.5);
    const dist = length(center);
    const lifeNode = useInstancing ? attribute('aLife') : uLife;
    const radiusNode = useInstancing ? attribute('aRadius') : uRadius;
    const colorNode = useInstancing ? attribute('aColor') : uColor;
    const radius = radiusNode.mul(0.5).add(float(0.05));
    const ring = smoothstep(radius, radius.sub(0.02), dist)
        .mul(smoothstep(radius.add(0.08), radius.add(0.06), dist));

    const alpha = ring.mul(lifeNode);
    const color = colorNode.mul(lifeNode);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);
    material.userData = {
        uColor, uLife, uRadius, uMaxRadius,
    };

    return material;
}

// ============================================================================
// SOFT SPRITE MATERIAL (atmospheric drift particles: dust motes, embers)
// ============================================================================
//
// Reads from a NeonDuskFieldCompute state/color buffer on WebGPU and renders a
// soft, round, depth-scaled sprite. Uses uv() (not pointUV) for the sprite
// coordinate — pointUV emits invalid WGSL in this three revision.

export function createSoftSpriteNodeMaterial(params = {}) {
    const material = new THREE.PointsNodeMaterial();
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.vertexColors = true;

    const uPixelRatio = uniform(params.pixelRatio ?? 1);
    const uTime = uniform(0);
    const uColorShift = uniform(params.colorShift ?? 0);
    const uBrightness = uniform(params.brightness ?? 1.0);
    const sizeScale = float(params.sizeScale ?? 280.0);
    const softness = float(params.softness ?? 1.7);
    const baseOpacity = float(params.opacity ?? 0.7);
    const enableColorShift = Boolean(params.enableColorShift);

    const useGPU = Boolean(
        params.isWebGPU && params.particleCompute?.getStateBuffer && params.particleCompute?.getColorBuffer,
    );
    const stateBuffer = useGPU
        ? storage(params.particleCompute.getStateBuffer(), 'vec4', params.particleCompute.count * 3)
        : null;
    const colorBuffer = useGPU
        ? storage(params.particleCompute.getColorBuffer(), 'vec4', params.particleCompute.count)
        : null;

    const aSize = attribute('aSize');
    const aLife = attribute('aLife');

    const basePos = useGPU ? stateBuffer.element(vertexIndex.mul(3)).xyz : positionLocal;
    const lifeNode = useGPU ? stateBuffer.element(vertexIndex.mul(3)).w : aLife;
    const sizeValue = useGPU ? stateBuffer.element(vertexIndex.mul(3).add(2)).x : aSize;
    const colorValue = useGPU ? colorBuffer.element(vertexIndex).xyz : vertexColor();

    material.positionNode = basePos;

    const sizeNode = sizeValue
        .mul(uPixelRatio)
        .mul(sizeScale.div(positionView.z.negate()));
    material.sizeNode = clamp(sizeNode, float(0.5), float(70.0));

    const center = uv().sub(0.5);
    const dist = length(center);
    const sprite = max(float(0.0), float(1.0).sub(dist.mul(2.0)));
    const soft = pow(sprite, softness);

    let color = colorValue.mul(uBrightness).mul(float(1.0).add(lifeNode.mul(0.4)));
    if (enableColorShift) {
        const shiftAmount = clamp(uColorShift, float(0.0), float(1.0)).mul(0.3);
        color = mix(color, vec3(1.0, 0.25, 0.9), shiftAmount);
    }
    const alpha = soft.mul(lifeNode).mul(baseOpacity);

    material.colorNode = color;
    material.opacityNode = alpha;
    material.emissiveNode = color.mul(alpha);
    material.userData = {
        uPixelRatio, uTime, uColorShift, uBrightness,
    };

    return material;
}

// ============================================================================
// HORIZON HAZE BAND MATERIAL
// ============================================================================
//
// A wide additive plane that sits behind the mountains and glows along the
// horizon line, giving the sun atmosphere to sit in and softening the hard
// mountain/sky seam. Brightest just below the horizon, fading up and outward.

export function createHorizonHazeNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const uColorLow = uniform(params.colorLow ?? new THREE.Color(0xff5a3c));
    const uColorHigh = uniform(params.colorHigh ?? new THREE.Color(0x7a1f5a));
    const uIntensity = uniform(params.intensity ?? 0.55);
    const uPulse = uniform(0);

    const coord = uv();
    // Vertical band: peak at lower third, soft falloff above and below
    const band = smoothstep(float(0.0), float(0.32), coord.y)
        .mul(float(1.0).sub(smoothstep(float(0.34), float(1.0), coord.y)));
    // Horizontal falloff toward the edges (concentrates glow around the sun)
    const horizontal = float(1.0).sub(smoothstep(float(0.1), float(0.55), abs(coord.x.sub(0.5))));

    const glow = pow(band, float(1.4)).mul(float(0.45).add(horizontal.mul(0.55)));
    const color = mix(uColorHigh, uColorLow, band);
    const intensity = glow.mul(uIntensity).mul(float(1.0).add(uPulse.mul(0.6)));

    material.colorNode = color;
    material.opacityNode = clamp(intensity, float(0.0), float(1.0));
    material.emissiveNode = color.mul(intensity);
    material.userData = {
        uColorLow, uColorHigh, uIntensity, uPulse,
    };

    return material;
}

// ============================================================================
// GROUND FOG MATERIAL (low drifting mist slabs)
// ============================================================================

export function createGroundFogNodeMaterial(params = {}) {
    const material = new THREE.MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const uColor = uniform(params.color ?? new THREE.Color(0x4a1d6b));
    const uOpacity = uniform(params.opacity ?? 0.08);
    const uTime = uniform(0);
    const uSeed = uniform(params.seed ?? 0);
    const uPulse = uniform(0);

    const coord = uv();
    const center = coord.sub(0.5);
    // Soft elliptical falloff (wide, short)
    const ell = length(vec2(center.x.mul(1.0), center.y.mul(2.2)));
    const blob = float(1.0).sub(smoothstep(float(0.18), float(0.5), ell));

    // Wispy animated noise so the mist breathes and drifts
    const t = uTime.add(uSeed);
    const wisp = sin(coord.x.mul(9.0).add(t.mul(0.6)))
        .mul(sin(coord.y.mul(7.0).sub(t.mul(0.4))))
        .mul(0.5)
        .add(0.5);

    const density = pow(blob, float(1.5)).mul(float(0.55).add(wisp.mul(0.45)));
    const intensity = density.mul(uOpacity).mul(float(1.0).add(uPulse.mul(0.5)));

    material.colorNode = uColor;
    material.opacityNode = clamp(intensity, float(0.0), float(1.0));
    material.emissiveNode = uColor.mul(intensity);
    material.userData = {
        uColor, uOpacity, uTime, uSeed, uPulse,
    };

    return material;
}
