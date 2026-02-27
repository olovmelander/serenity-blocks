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
    pointUV,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';

const BLOOM_CLASS_WEIGHTS = {
    road: 0.05,  // Low weight: lane stripes cause high-frequency flicker in bloom
    tunnelRing: 0.08, // Low weight: fresnel + camera sway causes bloom flicker
    planet: 0.64,
    planetGlow: 0.42,
    speedParticle: 0.74,
    ambientParticle: 0.62,
    shootingStar: 0.5, // Reduced from 0.78 to prevent bloom washout
    edgeGlow: 0.5,
    gasGiant: 0.6,
    iceMoon: 0.58,
    atmosphericOrb: 0.52,
    binaryStar: 0.7,
};

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
    const hue = fract(float(1.0).sub(uvCoord.y).mul(4.0).add(uProgress.mul(1.5)));
    const rainbow = tslHsv2rgb(hue, float(0.9), float(0.7));

    // Lane stripes with controlled pace-linked modulation
    const laneFrequency = float(86.0).add(uPace.sub(1.0).mul(34.0));
    const laneFlow = uProgress.mul(float(18.0).add(uPace.mul(8.0))).add(uTime.mul(0.65));
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
    const finalRoadColor = clamp(finalColor, vec3(0.0), vec3(1.06));

    material.colorNode = finalRoadColor;
    // Use smooth rainbow base for emissive (excludes lane stripes) to prevent bloom flicker
    material.emissiveNode = rainbow.mul(edgeMix).mul(depthMix).mul(BLOOM_CLASS_WEIGHTS.road);

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

    // Fresnel effect for edge glow (low power = broad, stable glow; less view-angle sensitivity)
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nrm = normalWorld;
    const fresnel = pow(float(1.0).sub(abs(dot(viewDir, nrm))), float(0.8));

    // Pulsing core brightness (very gentle to avoid bloom flicker)
    const pulse = float(1.0).add(sin(uTime.mul(1.2)).mul(0.05).mul(uPulse));

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
    const finalRingColor = clamp(ringColor, vec3(0.0), vec3(1.12));
    material.colorNode = finalRingColor;
    material.opacityNode = alpha;
    // Use stable core color for emissive (not fresnel-dependent edges) to prevent bloom flicker
    material.emissiveNode = coreColor.mul(BLOOM_CLASS_WEIGHTS.tunnelRing);

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
    const finalPlanetColor = clamp(finalColor, vec3(0.0), vec3(1.08));
    material.colorNode = finalPlanetColor;
    material.emissiveNode = rimGlow.add(innerGlow).mul(BLOOM_CLASS_WEIGHTS.planet);

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
    material.emissiveNode = glowColor.mul(uOpacity).mul(BLOOM_CLASS_WEIGHTS.planetGlow);

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
        const pulseLift = uPulse.mul(0.2);
        return colorAttr.add(vec3(pulseLift, pulseLift, pulseLift));
    })();
    material.colorNode = particleColor;

    material.opacityNode = Fn(() => {
        return float(0.62).add(uPulse.mul(0.12));
    })();

    material.sizeNode = sizeAttr;
    material.emissiveNode = particleColor.mul(BLOOM_CLASS_WEIGHTS.speedParticle);

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
        const glowLift = vAlpha.mul(0.15);
        return colorAttr.add(vec3(glowLift, glowLift, glowLift));
    })();
    material.colorNode = ambientColor;

    material.opacityNode = Fn(() => {
        return clamp(vAlpha.mul(0.72), float(0.06), float(1.0));
    })();

    material.sizeNode = sizeAttr.mul(float(1.0).add(uPulse.mul(0.5)));
    material.emissiveNode = ambientColor.mul(vAlpha).mul(BLOOM_CLASS_WEIGHTS.ambientParticle);

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
    const randomAttr = attribute('aRandom', 'float'); // Needed for wobble

    if (particleCompute) {
        const posData = storage(particleCompute.positionBuffer, 'vec4', particleCompute.count);
        positionAttr = posData.element(instanceIndex).xyz;
    } else {
        positionAttr = attribute('position', 'vec3');
    }

    // Burning Tail Effect (Ported from WebGL shader)
    // Wobble the tail particles based on size (smaller = tail) and time
    const burningPosition = Fn(() => {
        const pos = positionAttr.toVar();

        // Calculate tail factor: 1.0 for small particles (tail), 0.0 for large (head)
        // Adjust 50.0 to match the avg max size
        const tailFactor = float(1.0).sub(sizeAttr.div(60.0));
        const activeTail = max(float(0.0), tailFactor);

        // Apply wobble
        const wobbleSpeed = float(12.0);
        const wobbleScale = float(15.0); // Amplitude
        const t = uTime.mul(wobbleSpeed).add(randomAttr.mul(20.0));

        const offsetX = sin(t).mul(activeTail).mul(wobbleScale);
        const offsetY = cos(t.mul(0.8)).mul(activeTail).mul(wobbleScale);

        return pos.add(vec3(offsetX, offsetY, 0.0));
    })();

    material.positionNode = burningPosition;

    const starColor = Fn(() => {
        return colorAttr; // Use pure color from attribute without adding white
    })();
    material.colorNode = starColor;

    material.opacityNode = Fn(() => {
        return clamp(uOpacity, float(0.0), float(1.0));
    })();

    material.sizeNode = sizeAttr;
    material.emissiveNode = starColor.mul(uOpacity).mul(BLOOM_CLASS_WEIGHTS.shootingStar);

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
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: true,
    });
    material.fog = false;

    const uTime = uniform(0);
    const colorAttr = attribute('color', 'vec3');
    const sizeAttr = attribute('size', 'float');
    const twinkleAttr = attribute('twinkle', 'vec2');
    const twinkle = sin(uTime.mul(twinkleAttr.y).add(twinkleAttr.x)).mul(0.24).add(0.86);

    // WebGPU path: avoid point UV builtins (gl_PointCoord) because they can fail WGSL compilation.
    const sizeFactor = clamp(sizeAttr.div(32.0), float(0.35), float(1.0));
    const finalColor = colorAttr.mul(twinkle.mul(1.08)).add(vec3(0.02));
    const alpha = clamp(
        twinkle.mul(0.62).mul(sizeFactor).add(0.08),
        float(0.08),
        float(1.0),
    );
    const sizePulse = twinkle.mul(0.18).add(0.92);

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    material.sizeNode = min(float(14.0), max(float(2.0), sizeAttr.mul(sizePulse).mul(0.22)));
    material.emissiveNode = finalColor.mul(alpha.mul(0.8));

    return finalizeNodeMaterial(material, { uTime }, { emitsBloom: false, mrtRole: 'starfield' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nebula Backdrop Material
// ─────────────────────────────────────────────────────────────────────────────

export function createNebulaNodeMaterial(nebulaTexture) {
    const material = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
    });

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();

    // Sample the seamless rainbow nebula texture
    // Add subtle UV drift for internal movement
    const drift = vec2(
        sin(uTime.mul(0.05).add(uvCoord.y.mul(4.0))).mul(0.02),
        cos(uTime.mul(0.04).add(uvCoord.x.mul(4.0))).mul(0.02)
    );
    const texColor = texture(nebulaTexture, uvCoord.add(drift));

    // Pulse effect - brightness and slight color shift
    const pulseMul = float(1.0).add(uPulse.mul(float(0.4)));

    // Use texture alpha if present, or luminance for transparency
    const luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));

    // Radial mask to hide hard edges (vignette)
    const centerDist = length(uvCoord.sub(vec2(0.5)));
    const edgeMask = float(1.0).sub(smoothstep(float(0.35), float(0.5), centerDist));

    const alpha = max(texColor.a, luminance).mul(float(0.5)).mul(edgeMask); // Base opacity adjustment with mask

    // Final color composition
    const finalColor = texColor.rgb.mul(pulseMul).mul(float(1.2)); // Slight boost

    material.colorNode = finalColor;
    material.opacityNode = alpha;
    // Emissive for bloom
    material.emissiveNode = finalColor.mul(float(0.8));

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'nebula' }
    );
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
    material.emissiveNode = uColor.mul(uOpacity).mul(BLOOM_CLASS_WEIGHTS.edgeGlow);

    return finalizeNodeMaterial(
        material,
        { uColor, uOpacity },
        { emitsBloom: true, mrtRole: 'edge-glow' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Gas Giant Material (Jupiter Texture + Psychedelic Overlay)
// ─────────────────────────────────────────────────────────────────────────────

export function createGasGiantNodeMaterial(jupiterTexture) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const nrm = normalize(normalWorld);

    const texColor = texture(jupiterTexture, uvCoord).rgb;
    const bandContrast = smoothstep(float(0.25), float(0.85), texColor.g);
    const baseColor = mix(
        texColor.mul(0.78),
        texColor.mul(vec3(1.02, 0.98, 0.92)),
        bandContrast.mul(0.24),
    );

    const lightDir = normalize(vec3(0.58, 0.42, 0.38));
    const NdotL = max(dot(nrm, lightDir), float(0.0));
    const diffuse = NdotL.mul(0.72).add(0.28);
    const shadedColor = baseColor.mul(diffuse);

    const viewDot = clamp(dot(nrm, viewDir), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(viewDot), float(2.3));
    const atmosphere = vec3(0.36, 0.62, 0.94).mul(fresnel).mul(0.32);

    const finalColor = shadedColor
        .add(atmosphere)
        .mul(float(1.0).add(uPulse.mul(0.07)));
    material.colorNode = clamp(finalColor, vec3(0.0), vec3(1.0));
    material.opacityNode = float(1.0);
    material.emissiveNode = atmosphere.add(shadedColor.mul(0.04)).mul(BLOOM_CLASS_WEIGHTS.gasGiant);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'neon-gas-giant' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Ice Moon Material (Neptune Texture + Prismatic Fresnel)
// ─────────────────────────────────────────────────────────────────────────────

export function createIceMoonNodeMaterial(neptuneTexture) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const nrm = normalize(normalWorld);
    const viewDir = normalize(cameraPosition.sub(positionWorld));

    const texColor = texture(neptuneTexture, uvCoord).rgb;
    const crackBands = sin(uvCoord.y.mul(92.0).add(uTime.mul(0.02))).mul(0.015).add(0.985);
    const icyColor = mix(
        texColor.mul(0.62),
        texColor.mul(vec3(0.78, 0.9, 1.0)),
        float(0.46),
    ).mul(crackBands);

    const lightDir = normalize(vec3(0.5, 0.45, 0.55));
    const NdotL = max(dot(nrm, lightDir), float(0.0));
    const shadedColor = icyColor.mul(NdotL.mul(0.68).add(0.3));

    const viewDot = clamp(dot(nrm, viewDir), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(viewDot), float(2.4));
    const rimColor = vec3(0.58, 0.76, 1.0).mul(fresnel).mul(0.33);

    const moonColor = shadedColor.add(rimColor).mul(float(1.0).add(uPulse.mul(0.08)));
    material.colorNode = clamp(moonColor, vec3(0.0), vec3(1.0));
    material.opacityNode = float(1.0);
    material.emissiveNode = rimColor.add(shadedColor.mul(0.03)).mul(BLOOM_CLASS_WEIGHTS.iceMoon);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'crystal-moon' },
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Atmospheric Orb Material (Venus Texture + Warm Haze)
// ─────────────────────────────────────────────────────────────────────────────

export function createAtmosphericOrbNodeMaterial(venusTexture) {
    const material = new MeshBasicNodeMaterial();

    const uTime = uniform(0);
    const uPulse = uniform(0);

    const uvCoord = uv();
    const nrm = normalize(normalWorld);
    const viewDir = normalize(cameraPosition.sub(positionWorld));

    const scrolledUV = vec2(uvCoord.x.add(uTime.mul(0.003)), uvCoord.y);
    const texColor = texture(venusTexture, scrolledUV).rgb;
    const luminance = dot(texColor, vec3(0.299, 0.587, 0.114));
    const cloudColor = mix(vec3(luminance), texColor, float(0.62));
    const blendedColor = mix(cloudColor, cloudColor.mul(vec3(1.0, 0.88, 0.65)), float(0.28));

    const lightDir = normalize(vec3(-0.45, 0.3, 0.5));
    const NdotL = max(dot(nrm, lightDir), float(0.0));
    const shadedColor = blendedColor.mul(NdotL.mul(0.65).add(0.3));

    const viewDot = clamp(dot(nrm, viewDir), float(0.0), float(1.0));
    const fresnel = pow(float(1.0).sub(viewDot), float(2.0));
    const hazeColor = vec3(1.0, 0.78, 0.52).mul(fresnel).mul(0.29);

    const finalColor = shadedColor.add(hazeColor).mul(float(1.0).add(uPulse.mul(0.06)));
    material.colorNode = clamp(finalColor, vec3(0.0), vec3(1.0));
    material.opacityNode = float(1.0);
    material.emissiveNode = hazeColor.add(shadedColor.mul(0.03)).mul(BLOOM_CLASS_WEIGHTS.atmosphericOrb);

    return finalizeNodeMaterial(
        material,
        { uTime, uPulse },
        { emitsBloom: true, mrtRole: 'atmospheric-orb' },
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
    material.emissiveNode = finalColor.mul(BLOOM_CLASS_WEIGHTS.binaryStar);

    return finalizeNodeMaterial(
        material,
        { uTime, uHue },
        { emitsBloom: true, mrtRole: 'binary-star' },
    );
}
