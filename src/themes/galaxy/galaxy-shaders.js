/**
 * Galaxy Theme Shaders
 * GLSL shaders for the Three.js Galaxy theme
 */

/**
 * Galaxy Core Vertex Shader
 */
export const coreVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Galaxy Core Fragment Shader
 * Creates a glowing, pulsating core with color gradients
 */
export const coreFragmentShader = `
uniform float time;
uniform float intensity;
uniform vec3 colorPrimary;   // Deep pink/magenta
uniform vec3 colorSecondary; // Blue/cyan
uniform vec3 colorTertiary;  // Soft purple

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

// Simplex noise function
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
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
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main() {
    // Multi-layered noise for turbulent core
    float noise1 = snoise(vPosition * 0.8 + vec3(time * 0.15));
    float noise2 = snoise(vPosition * 1.5 - vec3(time * 0.25));
    float noise3 = snoise(vPosition * 2.5 + vec3(time * 0.1, time * 0.2, 0.0));
    
    float finalNoise = (noise1 + noise2 * 0.5 + noise3 * 0.25) * 0.4 + 0.5;
    
    // Fresnel for edge glow
    vec3 viewDir = normalize(cameraPosition - vPosition);
    float fresnel = pow(1.0 - dot(vNormal, viewDir), 2.0);
    
    // Color mixing - Pink/Magenta core, Blue rim
    vec3 coreColor = mix(colorPrimary, colorSecondary, finalNoise);
    
    // Add purple patches
    float patches = smoothstep(0.55, 0.75, noise2);
    vec3 complexCore = mix(coreColor, colorTertiary, patches * 0.6);
    
    // Fresnel rim color
    vec3 finalColor = mix(complexCore, colorSecondary, fresnel * 0.8);
    
    // Intensity pulse
    finalColor *= (0.8 + intensity * 0.4);
    
    // Hot white center
    float hotSpot = smoothstep(0.65, 0.95, finalNoise) * (1.0 - fresnel);
    finalColor += vec3(1.0, 0.95, 0.9) * hotSpot * 0.6;

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

/**
 * Spiral Galaxy Particle Vertex Shader
 * Creates spiral arm distribution with rotation
 */
export const spiralVertexShader = `
uniform float time;
uniform float spiralTightness;
uniform float uPulseTimers[8]; // Array of pulse timers for stacking effects
uniform int uPulseCount;
uniform float uLockGlow;
uniform vec3 uLockDirection;

attribute float aAngle;
attribute float aRadius;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    // Spiral rotation based on radius
    float spiralAngle = aAngle + aRadius * spiralTightness - time * 0.05;
    
    // Add some organic wobble
    float wobble = sin(time * 0.3 + aRandom * 6.28) * 0.1;
    
    vec3 pos;
    pos.x = cos(spiralAngle) * aRadius * (1.0 + wobble);
    pos.y = (aRandom - 0.5) * 0.8; // Flattened disk with some height variation
    pos.z = sin(spiralAngle) * aRadius * (1.0 + wobble);

    vec2 lockVector = uLockDirection.xz;
    float directionStrength = clamp(length(lockVector), 0.0, 1.0);
    vec2 radialDir = normalize(pos.xz + vec2(0.0001));
    vec2 normalizedLockDir = directionStrength > 0.001 ? normalize(lockVector) : vec2(0.0);
    float sector = directionStrength > 0.001 ? max(dot(radialDir, normalizedLockDir), 0.0) : 1.0;
    float lockBoost = uLockGlow * mix(1.0, 0.65 + 0.35 * sector, directionStrength);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Find the best active pulse for this particle (closest to its radius)
    float pulseIntensity = 0.0;
    float tailLength = 8.0;
    
    for (int i = 0; i < 8; i++) {
        if (i >= uPulseCount) break;
        float diff = uPulseTimers[i] - aRadius;
        
        if (diff > 0.0 && diff < tailLength) {
            // Linear fade from 1.0 (at wave front) to 0.0 (at end of tail)
            float intensity = 1.0 - (diff / tailLength);
            
            // Optional: curve the falloff for a "hotter" head
            intensity = pow(intensity, 1.5);
            
            // Additive blending for multiple overlapping pulses
            pulseIntensity += intensity;
        }
    }
    
    // Size attenuation - larger stars appear bigger
    // Pulse increases size significantly
    float baseSize = 3.0 + aRandom * 5.0;
    // Boost size most at the leading edge
    float pulseSize = baseSize * (1.0 + pulseIntensity * 3.0 + lockBoost * 0.12);
    gl_PointSize = pulseSize * (15.0 / -mvPosition.z);
    
    // Color modulation
    // Pulse adds brightness/whiteness
    // Mix to white at high intensity, then fade back to original color
    vec3 mixedColor = mix(aColor, vec3(1.0, 1.0, 1.0), min(1.0, pulseIntensity + lockBoost * 0.25));
    vColor = mixedColor * (1.0 + pulseIntensity * 2.0 + lockBoost * 0.25);
    
    // Stars closer to center are brighter
    vAlpha = (0.4 + 0.6 * (1.0 - aRadius / 15.0)) * (1.0 + lockBoost * 0.12);
}
`;

/**
 * Spiral Galaxy Particle Fragment Shader
 */
export const spiralFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    // Soft circular particle
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    float alpha = vAlpha * (1.0 - smoothstep(0.3, 1.0, dist));
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

/**
 * Nebula Cloud Vertex Shader
 */
export const nebulaVertexShader = `
varying vec2 vUv;
varying vec3 vWorldCenter;

void main() {
    vUv = uv;
    vWorldCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Nebula Cloud Fragment Shader
 * Creates soft, flowing nebula clouds
 */
export const nebulaFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 colorA;
uniform vec3 colorB;
uniform float uLockNebulaBoost;
uniform vec3 uLockDirection;

varying vec2 vUv;
varying vec3 vWorldCenter;

// Simplified noise
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

void main() {
    vec2 uv = vUv - 0.5;
    
    // Animated noise
    float n1 = fbm(uv * 3.0 + time * 0.02);
    float n2 = fbm(uv * 2.0 - time * 0.015 + vec2(5.0, 3.0));
    
    float finalNoise = (n1 + n2) * 0.5;
    
    // Radial falloff
    float dist = length(uv) * 2.0;
    float falloff = 1.0 - smoothstep(0.2, 1.0, dist);
    
    // Color mix
    vec3 color = mix(colorA, colorB, finalNoise);

    vec2 lockVector = uLockDirection.xz;
    float directionStrength = clamp(length(lockVector), 0.0, 1.0);
    vec2 cloudDir = normalize(vWorldCenter.xz + vec2(0.0001));
    vec2 normalizedLockDir = directionStrength > 0.001 ? normalize(lockVector) : vec2(0.0);
    float sector = directionStrength > 0.001 ? max(dot(cloudDir, normalizedLockDir), 0.0) : 1.0;
    float lockBoost = uLockNebulaBoost * mix(1.0, 0.72 + 0.28 * sector, directionStrength);
    vec3 nebulaHighlight = mix(vec3(0.65, 0.85, 1.0), vec3(1.0), finalNoise * 0.4);
    color = mix(color, nebulaHighlight, min(0.22, lockBoost * 0.18));
    
    float alpha = finalNoise * falloff * opacity * (1.0 + lockBoost * 0.18);
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Shockwave Vertex Shader
 */
export const shockwaveVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Shockwave Fragment Shader
 */
export const shockwaveFragmentShader = `
uniform float time;
uniform float opacity;
uniform vec3 color;

varying vec2 vUv;
varying vec3 vNormal;

void main() {
    float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
    gl_FragColor = vec4(color, opacity * (0.3 + intensity));
}
`;

/**
 * Cosmic Dust Particle Vertex Shader
 */
export const dustVertexShader = `
uniform float time;
uniform float uLockDustBoost;
uniform vec3 uLockDirection;
attribute float aRandom;
attribute float aSize;

varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Slow orbital drift
    float angle = -time * 0.03 * (0.5 + aRandom);
    float s = sin(angle);
    float c = cos(angle);
    vec3 rotatedPos = vec3(pos.x * c - pos.z * s, pos.y, pos.x * s + pos.z * c);
    
    // Gentle float
    rotatedPos.y += sin(time * 0.5 + aRandom * 10.0) * 0.3;

    vec2 lockVector = uLockDirection.xz;
    float directionStrength = clamp(length(lockVector), 0.0, 1.0);
    vec2 dustDir = normalize(rotatedPos.xz + vec2(0.0001));
    vec2 normalizedLockDir = directionStrength > 0.001 ? normalize(lockVector) : vec2(0.0);
    float sector = directionStrength > 0.001 ? max(dot(dustDir, normalizedLockDir), 0.0) : 1.0;
    float lockBoost = uLockDustBoost * mix(1.0, 0.72 + 0.28 * sector, directionStrength);
    rotatedPos.xz += normalizedLockDir * lockBoost * (0.25 + aRandom * 0.25);
    
    vec4 mvPosition = modelViewMatrix * vec4(rotatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = aSize * (1.0 + lockBoost * 0.15) * (20.0 / -mvPosition.z);
    
    vAlpha = (0.3 + 0.4 * sin(time * 1.5 + aRandom * 10.0)) * (1.0 + lockBoost * 0.15);
}
`;

/**
 * Cosmic Dust Particle Fragment Shader
 */
export const dustFragmentShader = `
uniform vec3 color;

varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    float alpha = vAlpha * (1.0 - smoothstep(0.5, 1.0, dist));
    
    gl_FragColor = vec4(color, alpha);
}
`;

/**
 * Background Stars Vertex Shader (with twinkling)
 */
export const starsVertexShader = `
uniform float time;
uniform float uLockStarBoost;
uniform vec3 uLockDirection;
attribute float aRandom;
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vec2 lockVector = uLockDirection.xz;
    float directionStrength = clamp(length(lockVector), 0.0, 1.0);
    vec2 starDir = normalize(position.xz + vec2(0.0001));
    vec2 normalizedLockDir = directionStrength > 0.001 ? normalize(lockVector) : vec2(0.0);
    float sector = directionStrength > 0.001 ? max(dot(starDir, normalizedLockDir), 0.0) : 1.0;
    float lockBoost = uLockStarBoost * mix(1.0, 0.78 + 0.22 * sector, directionStrength);
    
    // Size based on distance and randomness
    float baseSize = 1.5 + aRandom * 3.0;
    gl_PointSize = baseSize * (1.0 + lockBoost * 0.1) * (30.0 / -mvPosition.z);
    
    vColor = mix(aColor, vec3(1.0), min(0.22, lockBoost * 0.2));
    // Twinkling effect
    vAlpha = (0.8 + 0.2 * sin(time * (1.0 + aRandom * 2.0) + aRandom * 6.28)) * (1.0 + lockBoost * 0.1);
}
`;

/**
 * Background Stars Fragment Shader
 */
export const starsFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    // Soft glow
    float alpha = vAlpha * (1.0 - smoothstep(0.2, 1.0, dist));
    
    gl_FragColor = vec4(vColor, alpha);
}
`;

/**
 * Spiral Spark Vertex Shader
 * Particles that erupt from the spiral arms when the pulse wave passes
 */
export const sparkVertexShader = `
uniform float time;
uniform float spiralTightness;
uniform float uPulseTimers[8]; // Array of pulse timers for stacking effects
uniform int uPulseCount;
uniform float uLockSparkle;
uniform vec3 uLockDirection;

attribute float aAngle;
attribute float aRadius;
attribute float aRandom;
attribute vec3 aRandomDir; // Unique direction for each spark
attribute vec3 aColor;

varying vec3 vColor;
varying float vAlpha;

void main() {
    // Initial Spiral Position (where the spark is born)
    float paramAngle = aAngle + aRadius * spiralTightness - time * 0.05;
    
    vec3 initialPos;
    initialPos.x = cos(paramAngle) * aRadius;
    initialPos.y = (aRandom - 0.5) * 0.5;
    initialPos.z = sin(paramAngle) * aRadius;

    vec2 lockVector = uLockDirection.xz;
    float directionStrength = clamp(length(lockVector), 0.0, 1.0);
    vec2 radialDir = normalize(initialPos.xz + vec2(0.0001));
    vec2 normalizedLockDir = directionStrength > 0.001 ? normalize(lockVector) : vec2(0.0);
    float sector = directionStrength > 0.001 ? max(dot(radialDir, normalizedLockDir), 0.0) : 1.0;
    float sparkleSector = mix(1.0, 0.76 + 0.24 * sector, directionStrength);
    
    // Find the pulse that this spark should follow
    // Use the pulse with the largest valid age (i.e., the one that passed most recently)
    float bestAge = -1.0;
    float maxLife = 100.0;
    
    // Assign this particle to a specific pulse slot to allow multiple independent rings
    // We use the particle's random value to pick one of the 8 pulse slots
    // This distributes the ~8000 sparks into 8 groups of ~1000 sparks each.
    // Each group only responds to ITS assigned pulse slot.
    // This prevents particles from snapping between different active pulses.
    int mySlot = int(floor(aRandom * 8.0));
    if (mySlot >= 8) mySlot = 7; // Safety clamp
    
    // Check ONLY this assigned slot
    float age = uPulseTimers[mySlot] - aRadius;
    
    if (age > 0.0 && age < maxLife) {
        bestAge = age; // This is the only age that matters for this particle
    }

    vec3 animatedPos = initialPos;
    float alpha = 0.0;
    float size = 0.0;
    
    if (bestAge > 0.0) {
        // Eruption!
        
        // Fly outward from center + random spread
        // Normalized radial direction
        vec3 radialDir = normalize(initialPos + vec3(0.01)); // avoid 0
        
        // Mix radial uniform movement with chaotic random spread
        // Ultra slow majestic drift (was 7.0)
        vec3 velocity = mix(radialDir, aRandomDir, 0.7) * 3.5; 
        
        // Apply velocity over time (age)
        animatedPos += velocity * bestAge;
        
        // Visuals
        alpha = 1.0 - (bestAge / maxLife); // Fade out
        alpha = pow(alpha, 0.5); // Stay visible longer
        
        size = (1.0 - (bestAge / maxLife)) * 5.0; // Start larger
    } else if (uLockSparkle > 0.0) {
        float sparkleMask = step(0.995, fract(aRandom * 91.137 + 0.17));
        float sparklePulse = 0.72 + 0.28 * sin(time * 12.0 + aRandom * 40.0);
        float sparkle = uLockSparkle * sparkleMask * sparkleSector * sparklePulse;
        alpha = min(1.0, sparkle * 1.3);
        size = sparkle * (1.8 + aRandom * 2.2);
    }

    vec4 mvPosition = modelViewMatrix * vec4(animatedPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    gl_PointSize = size * (20.0 / -mvPosition.z);
    
    vColor = mix(aColor, vec3(1.0), min(0.7, uLockSparkle * 0.65));
    vAlpha = alpha;
}
`;

/**
 * Spiral Spark Fragment Shader
 */
export const sparkFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    if (vAlpha <= 0.01) discard;

    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = dot(circCoord, circCoord);
    if (dist > 1.0) discard;
    
    // Bright hot center
    float core = 1.0 - smoothstep(0.0, 0.4, dist);
    
    // Soft outer glow
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    
    vec3 finalColor = mix(vColor, vec3(1.0), core * 0.8);
    
    gl_FragColor = vec4(finalColor, vAlpha * glow);
}
`;
