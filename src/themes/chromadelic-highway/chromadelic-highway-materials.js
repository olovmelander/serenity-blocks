/**
 * Chromadelic Highway - TSL Node Materials (WebGPU Path)
 *
 * All materials use Three Shading Language (TSL) for WebGPU rendering.
 * Each factory returns { material, uniforms } for easy uniform updates.
 */

import {
    AdditiveBlending,
    DoubleSide,
    MeshBasicNodeMaterial,
    PointsNodeMaterial,
    LineBasicNodeMaterial,
} from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    clamp,
    cos,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    length,
    max,
    min,
    mix,
    normalize,
    normalWorld,
    normalLocal,
    cameraPosition,
    positionLocal,
    positionWorld,
    pow,
    sin,
    smoothstep,
    storage,
    texture,
    uniform,
    uv,
    vec2,
    vec3,
    vec4,
    pointUV,
} from 'three/tsl';

// ─────────────────────────────────────────────────────────────────────────────
// TSL Helpers
// ─────────────────────────────────────────────────────────────────────────────

function tslHsv2rgb(h, s, v) {
    const c = v.mul(s);
    const x = c.mul(float(1.0).sub(abs(fract(h.mul(6.0)).sub(1.0).abs().sub(1.0))));
    const m = v.sub(c);

    // Simplified HSV to RGB via smooth cosine approximation
    const r = v.mul(
        float(1.0).sub(
            s.mul(
                max(
                    float(0.0),
                    min(
                        float(1.0),
                        abs(fract(h.add(1.0)).mul(6.0).sub(3.0)).sub(1.0),
                    ),
                ),
            ),
        ),
    );
    const g = v.mul(
        float(1.0).sub(
            s.mul(
                max(
                    float(0.0),
                    min(
                        float(1.0),
                        abs(fract(h.add(2.0 / 3.0)).mul(6.0).sub(3.0)).sub(1.0),
                    ),
                ),
            ),
        ),
    );
    const b = v.mul(
        float(1.0).sub(
            s.mul(
                max(
                    float(0.0),
                    min(
                        float(1.0),
                        abs(fract(h.add(1.0 / 3.0)).mul(6.0).sub(3.0)).sub(1.0),
                    ),
                ),
            ),
        ),
    );

    return vec3(r, g, b);
}

function finalizeNodeMaterial(material, uniforms = {}, meta = {}) {
    material.userData = {
        ...(material.userData || {}),
        uniforms,
        ...meta,
    };
    return { material, uniforms };
}

// ─────────────────────────────────────────────────────────────────────────────
// Road Surface Material
// ─────────────────────────────────────────────────────────────────────────────

export function createRoadNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uProgress = uniform(0);
    const uPulse = uniform(0);
    const uPace = uniform(1.0);

    const uvCoord = uv();
    const viewPos = positionLocal;
    const depth = viewPos.z.negate();

    // Rainbow bands flowing forward
    const hue = fract(float(1.0).sub(uvCoord.y).mul(4.0).add(uProgress.mul(0.5)));
    const rainbow = tslHsv2rgb(hue, float(0.9), float(0.7));

    // Lane stripes with controlled pace-linked modulation
    const laneFrequency = float(86.0).add(uPace.sub(1.0).mul(34.0));
    const laneFlow = uProgress.mul(float(18.0).add(uPace.mul(6.0))).add(uTime.mul(0.15));
    const lanes = abs(sin(float(1.0).sub(uvCoord.y).mul(laneFrequency).add(laneFlow)));
    const laneLow = clamp(float(0.68).sub(uPace.sub(1.0).mul(0.08)), float(0.5), float(0.85));
    const laneHigh = clamp(float(0.9).sub(uPace.sub(1.0).mul(0.04)), float(0.74), float(0.97));
    const laneGlow = smoothstep(laneLow, laneHigh, lanes).mul(float(0.12).add(uPace.mul(0.05)));

    // Edge glow
    const edgeLeft = smoothstep(float(0.0), float(0.15), uvCoord.x);
    const edgeRight = smoothstep(float(1.0), float(0.85), uvCoord.x);
    const edge = edgeLeft.mul(edgeRight);
    const edgeMix = edge.mul(0.8).add(0.2);

    // Depth fade
    const depthFade = smoothstep(float(2000.0), float(200.0), depth);
    const depthMix = float(0.3).add(depthFade.mul(0.7));

    // Pulse effect
    const pulseMul = float(1.0).add(uPulse.mul(0.3));
    const paceMul = float(1.0).add(uPace.sub(1.0).mul(0.12));

    const finalColor = rainbow.add(laneGlow).mul(edgeMix).mul(depthMix).mul(pulseMul).mul(paceMul);

    material.colorNode = finalColor;
    material.emissiveNode = finalColor.mul(0.7);

    return finalizeNodeMaterial(
        material,
        { uTime, uProgress, uPulse, uPace },
        { emitsBloom: true, mrtRole: 'road' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tunnel Ring (Neon Glow) Material
// ─────────────────────────────────────────────────────────────────────────────

export function createTunnelRingNodeMaterial(colorVec3) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uColor = uniform(colorVec3);
    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uGlow = uniform(0);

    // Fresnel effect for edge glow
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nrm = normalWorld;
    const fresnel = pow(float(1.0).sub(abs(dot(viewDir, nrm))), float(2.0));

    // Pulsing core brightness
    const pulse = float(1.0).add(sin(uTime.mul(3.0)).mul(0.15).mul(uPulse));

    // Neon core (bright center)
    const coreColor = uColor.mul(float(1.5).add(uGlow.mul(0.5))).mul(pulse);

    // Outer glow (softer, wider)
    const glowColor = uColor.mul(float(0.6).add(fresnel.mul(0.8)));

    // Combine core and glow
    const finalColor = mix(coreColor, glowColor, fresnel.mul(0.5));

    // Add extra bloom on edges
    const edgeBloom = uColor.mul(fresnel).mul(0.4).mul(float(1.0).add(uGlow));

    // Alpha with pulse
    const alpha = float(0.7).add(fresnel.mul(0.3)).mul(float(0.8).add(uPulse.mul(0.2)));

    const ringColor = finalColor.add(edgeBloom);
    material.colorNode = ringColor;
    material.opacityNode = alpha;
    material.emissiveNode = ringColor.mul(1.1);

    return finalizeNodeMaterial(
        material,
        { uColor, uTime, uPulse, uGlow },
        { emitsBloom: true, mrtRole: 'tunnel-ring' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rainbow Planet Material
// ─────────────────────────────────────────────────────────────────────────────

export function createPlanetNodeMaterial(planetTexture) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nrm = normalWorld;

    // Sample the rainbow planet texture
    const texColor = texture(planetTexture, uvCoord);
    const baseColor = texColor.rgb;

    // Lighting - dramatic side lighting
    const lightDir = normalize(vec3(0.6, 0.4, 0.5));
    const NdotL = dot(nrm, lightDir);
    const shadow = smoothstep(float(-0.2), float(0.4), NdotL);

    // Apply shadow
    const shadowColor = baseColor.mul(0.15);
    const litColor = mix(shadowColor, baseColor, shadow);

    // Neon rainbow rim glow - fresnel
    const viewDot = abs(dot(nrm, viewDir));
    const fresnel = pow(float(1.0).sub(viewDot), float(3.0));

    // Animated rainbow hue cycling around the rim
    const rimHue = fract(uTime.mul(0.1).add(fresnel.mul(2.0)));
    const rainbowRim = tslHsv2rgb(rimHue, float(0.9), float(1.0));

    // Add neon rim glow
    const rimGlow = rainbowRim.mul(fresnel).mul(0.8).mul(float(1.0).add(uPulse.mul(0.5)));

    // Additional inner glow
    const innerFresnel = pow(float(1.0).sub(viewDot), float(1.5));
    const innerGlow = baseColor.mul(innerFresnel).mul(0.3);

    // Pulse brightness boost
    const pulseMul = float(1.0).add(uPulse.mul(0.2));

    const finalColor = litColor.add(rimGlow).add(innerGlow).mul(pulseMul);
    material.colorNode = finalColor;
    material.emissiveNode = rimGlow.add(innerGlow).mul(0.9);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'planet' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Planet Glow Layer Material
// ─────────────────────────────────────────────────────────────────────────────

export function createPlanetGlowNodeMaterial(glowTexture, baseOpacity) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    const uOpacity = uniform(baseOpacity);

    const glowColor = texture(glowTexture, uv()).rgb;
    material.colorNode = glowColor;
    material.opacityNode = uOpacity;
    material.emissiveNode = glowColor.mul(uOpacity);

    return finalizeNodeMaterial(
        material,
        { uOpacity },
        { emitsBloom: true, mrtRole: 'planet-glow' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Speed Particle Material
// ─────────────────────────────────────────────────────────────────────────────

export function createSpeedParticleNodeMaterial(opts = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
    });

    const uPulse = uniform(0);

    const particleCompute = opts.particleCompute;
    let positionAttr;
    let colorAttr;
    let sizeAttr;

    if (particleCompute) {
        // GPU compute-driven: read from storage buffers
        const posData = storage(particleCompute.positionBuffer, 'vec4', particleCompute.count);
        const miscData = storage(particleCompute.miscBuffer, 'vec4', particleCompute.count);
        const lifeData = storage(particleCompute.lifeBuffer, 'vec4', particleCompute.count);

        const pos = posData.element(instanceIndex);
        const misc = miscData.element(instanceIndex);
        const life = lifeData.element(instanceIndex);

        positionAttr = pos.xyz;
        colorAttr = life.yzw;
        sizeAttr = misc.x.mul(float(1.0).add(uPulse.mul(0.5)));
    } else {
        // CPU-driven attributes
        positionAttr = attribute('position', 'vec3');
        colorAttr = attribute('color', 'vec3');
        sizeAttr = attribute('size', 'float').mul(float(1.0).add(uPulse.mul(0.5)));
    }

    material.positionNode = positionAttr;

    const particleColor = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        const core = smoothstep(float(0.3), float(0.0), dist).mul(0.6);
        return colorAttr.add(core);
    })();
    material.colorNode = particleColor;

    material.opacityNode = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        return smoothstep(float(0.5), float(0.1), dist).mul(0.7);
    })();

    material.sizeNode = sizeAttr;
    material.emissiveNode = particleColor.mul(0.8);

    return finalizeNodeMaterial(
        material,
        { uPulse },
        { emitsBloom: true, mrtRole: 'speed-particle' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ambient Particle Material
// ─────────────────────────────────────────────────────────────────────────────

export function createAmbientParticleNodeMaterial(opts = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
    });

    const uTime = uniform(0);
    const uPulse = uniform(0);
    const uSpeedMultiplier = uniform(1.0);
    const particleCompute = opts.particleCompute;
    let positionNode;
    let colorAttr;
    let sizeAttr;
    let randomAttr;

    if (particleCompute) {
        const posData = storage(particleCompute.positionBuffer, 'vec4', particleCompute.count);
        const miscData = storage(particleCompute.miscBuffer, 'vec4', particleCompute.count);
        const lifeData = storage(particleCompute.lifeBuffer, 'vec4', particleCompute.count);

        const pos = posData.element(instanceIndex);
        const misc = miscData.element(instanceIndex);
        const life = lifeData.element(instanceIndex);

        positionNode = pos.xyz;
        colorAttr = life.yzw;
        sizeAttr = misc.x;
        randomAttr = life.x;
    } else {
        const basePos = attribute('position', 'vec3');
        colorAttr = attribute('color', 'vec3');
        sizeAttr = attribute('size', 'float');
        randomAttr = attribute('aRandom', 'float');

        const orbitSpeed = float(0.05).add(randomAttr.mul(0.05)).mul(uSpeedMultiplier);
        const angle = uTime.mul(orbitSpeed);
        const s = sin(angle);
        const c = cos(angle);
        const rotatedPos = vec3(
            basePos.x.mul(c).sub(basePos.z.mul(s)),
            basePos.y,
            basePos.x.mul(s).add(basePos.z.mul(c)),
        );
        positionNode = vec3(
            rotatedPos.x.add(sin(uTime.mul(0.2).add(randomAttr.mul(5.0))).mul(10.0)),
            rotatedPos.y.add(sin(uTime.mul(0.3).add(randomAttr.mul(10.0))).mul(15.0)),
            rotatedPos.z,
        );
    }

    material.positionNode = positionNode;

    // Pulsing alpha
    const vAlpha = float(0.4).add(
        sin(uTime.mul(1.5).add(randomAttr.mul(10.0))).mul(0.4),
    ).add(uPulse.mul(0.3));

    const ambientColor = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        const core = smoothstep(float(0.3), float(0.0), dist).mul(0.5);
        return colorAttr.add(core);
    })();
    material.colorNode = ambientColor;

    material.opacityNode = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        return smoothstep(float(0.5), float(0.1), dist).mul(vAlpha);
    })();

    material.sizeNode = sizeAttr.mul(float(1.0).add(uPulse.mul(0.5)));
    material.emissiveNode = ambientColor.mul(vAlpha).mul(0.7);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse, uSpeedMultiplier },
        { emitsBloom: true, mrtRole: 'ambient-particle' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shooting Star Material
// ─────────────────────────────────────────────────────────────────────────────

export function createShootingStarNodeMaterial(opts = {}) {
    const material = new PointsNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
    });

    const uOpacity = uniform(1.0);
    const uTime = uniform(0.0);

    const particleCompute = opts.particleCompute;
    let positionAttr;
    const colorAttr = attribute('color', 'vec3');
    const sizeAttr = attribute('size', 'float');

    if (particleCompute) {
        const posData = storage(particleCompute.positionBuffer, 'vec4', particleCompute.count);
        positionAttr = posData.element(instanceIndex).xyz;
    } else {
        positionAttr = attribute('position', 'vec3');
    }

    material.positionNode = positionAttr;

    const starColor = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        const core = smoothstep(float(0.25), float(0.0), dist).mul(0.6);
        return colorAttr.add(core);
    })();
    material.colorNode = starColor;

    material.opacityNode = Fn(() => {
        const center = pointUV.sub(vec2(0.5, 0.5));
        const dist = length(center);
        return smoothstep(float(0.5), float(0.0), dist).mul(uOpacity);
    })();

    material.sizeNode = sizeAttr;
    material.emissiveNode = starColor.mul(uOpacity);

    return finalizeNodeMaterial(
        material,
        { uOpacity, uTime },
        { emitsBloom: true, mrtRole: 'shooting-star' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield Material
// ─────────────────────────────────────────────────────────────────────────────

export function createStarfieldNodeMaterial() {
    const material = new PointsNodeMaterial({
        transparent: true,
        sizeAttenuation: true,
    });

    const colorAttr = attribute('color', 'vec3');

    material.colorNode = colorAttr;
    material.opacityNode = float(0.8);
    material.sizeNode = float(2.0);
    material.emissiveNode = vec3(0.0);

    return finalizeNodeMaterial(material, {}, { emitsBloom: false, mrtRole: 'starfield' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nebula Backdrop Material
// ─────────────────────────────────────────────────────────────────────────────

export function createNebulaNodeMaterial(nebulaTexture) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
    });

    material.colorNode = texture(nebulaTexture, uv()).rgb;
    material.opacityNode = float(1.0);
    material.emissiveNode = vec3(0.0);

    return finalizeNodeMaterial(material, {}, { emitsBloom: false, mrtRole: 'nebula' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge Glow Strip Material
// ─────────────────────────────────────────────────────────────────────────────

export function createEdgeGlowNodeMaterial(colorVec3, opacity) {
    const material = new LineBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
    });

    const uColor = uniform(colorVec3);
    const uOpacity = uniform(opacity);

    material.colorNode = uColor;
    material.opacityNode = uOpacity;
    material.emissiveNode = uColor.mul(uOpacity);

    return finalizeNodeMaterial(
        material,
        { uColor, uOpacity },
        { emitsBloom: true, mrtRole: 'edge-glow' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Neon Gas Giant Material (New Planet - Procedural)
// ─────────────────────────────────────────────────────────────────────────────

export function createNeonGasGiantNodeMaterial() {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nrm = normalWorld;

    // Procedural swirling neon bands
    const bandFreq = float(8.0);
    const bandOffset = sin(uvCoord.x.mul(3.0).add(uTime.mul(0.05))).mul(0.15);
    const bandY = uvCoord.y.add(bandOffset);
    const bandHue = fract(bandY.mul(bandFreq).add(uTime.mul(0.02)));
    const bandColor = tslHsv2rgb(bandHue, float(0.85), float(0.6));

    // Atmospheric depth - darker at edges
    const viewDot = abs(dot(nrm, viewDir));
    const atmosphere = pow(viewDot, float(0.6));
    const atmosphereColor = bandColor.mul(atmosphere);

    // Neon rim glow
    const fresnel = pow(float(1.0).sub(viewDot), float(2.5));
    const rimHue = fract(uTime.mul(0.08));
    const rimColor = tslHsv2rgb(rimHue, float(0.9), float(1.0)).mul(fresnel).mul(0.6);

    // Pulse
    const finalColor = atmosphereColor.add(rimColor).mul(float(1.0).add(uPulse.mul(0.15)));
    material.colorNode = finalColor;
    material.emissiveNode = rimColor.add(atmosphereColor.mul(0.2));

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'neon-gas-giant' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Crystal Moon Material (New Planet - Procedural Facets)
// ─────────────────────────────────────────────────────────────────────────────

export function createCrystalMoonNodeMaterial() {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
    });

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const nrm = normalWorld;
    const viewDir = normalize(cameraPosition.sub(positionWorld));

    // Faceted crystal look using normal-based coloring
    const facetHue = fract(
        dot(nrm, vec3(1.0, 0.5, 0.3)).mul(2.0).add(uTime.mul(0.03)),
    );
    const crystalColor = tslHsv2rgb(facetHue, float(0.7), float(0.8));

    // Prismatic glow at edges
    const viewDot = abs(dot(nrm, viewDir));
    const fresnel = pow(float(1.0).sub(viewDot), float(2.0));
    const prismColor = tslHsv2rgb(
        fract(fresnel.mul(3.0).add(uTime.mul(0.05))),
        float(0.9),
        float(1.0),
    );

    const finalColor = mix(crystalColor, prismColor, fresnel.mul(0.7));
    const moonColor = finalColor.mul(float(1.0).add(uPulse.mul(0.2)));
    material.colorNode = moonColor;
    material.opacityNode = float(0.85).add(fresnel.mul(0.15));
    material.emissiveNode = moonColor.mul(0.75);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'crystal-moon' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary Star Material (Twin Glowing Orbs)
// ─────────────────────────────────────────────────────────────────────────────

export function createBinaryStarNodeMaterial(starHue) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
    });

    const uTime = uniform(0);
    const uHue = uniform(starHue);

    const nrm = normalWorld;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const viewDot = abs(dot(nrm, viewDir));

    // Bright glowing core
    const coreColor = tslHsv2rgb(uHue, float(0.3), float(1.0));

    // Glow falloff at edges
    const glow = pow(viewDot, float(0.5));
    const edgeGlow = pow(float(1.0).sub(viewDot), float(1.5));
    const edgeColor = tslHsv2rgb(uHue, float(0.8), float(1.0));

    const finalColor = coreColor.mul(glow).add(edgeColor.mul(edgeGlow).mul(0.5));
    material.colorNode = finalColor;
    material.opacityNode = float(0.9).add(edgeGlow.mul(0.1));
    material.emissiveNode = finalColor;

    return finalizeNodeMaterial(
        material,
        { uTime, uHue },
        { emitsBloom: true, mrtRole: 'binary-star' },
    );
}
