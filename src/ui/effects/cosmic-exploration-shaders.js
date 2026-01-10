/**
 * Cosmic Exploration Shaders
 * 
 * GLSL shaders for the immersive cosmic effect during minimap exploration.
 * Adapted from cosmic-noir-shaders.js for the exploration overlay.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared Noise Functions
// ─────────────────────────────────────────────────────────────────────────────
const noiseCommon = `
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
`;

// ─────────────────────────────────────────────────────────────────────────────
// Star Shader - Twinkling stars with drift animation
// ─────────────────────────────────────────────────────────────────────────────
export const explorationStarVertexShader = `
attribute float aSize;
attribute vec2 aTwinkle; // x = phase offset, y = speed multiplier
attribute float aBrightness;

uniform float uTime;
uniform float uPixelRatio;
uniform float uDriftX;
uniform float uDriftY;
uniform float uFadeAlpha;

varying float vBrightness;
varying vec3 vColor;

void main() {
    vColor = color;
    
    // Twinkle animation with varied speed per star
    float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
    vBrightness = aBrightness * (0.6 + twinkle * 0.4) * uFadeAlpha;
    
    // Apply drift offset based on camera velocity
    vec3 driftedPos = position;
    driftedPos.x += uDriftX * (1.0 + aBrightness * 0.5);
    driftedPos.y += uDriftY * (1.0 + aBrightness * 0.5);
    
    vec4 mvPosition = modelViewMatrix * vec4(driftedPos, 1.0);
    
    // Size attenuation for depth
    gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 2.0, 60.0);
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const explorationStarFragmentShader = `
uniform float uHeight; // 0.0 (top) to 1.0 (bottom) - INVERTED in JS, so 0=top, 1=bottom. 
// Actually, let's assume JS passes 0.0=bottom (start), 1.0=top (goal) for intuitive color mapping.

varying float vBrightness;
varying vec3 vColor;

vec3 getHeightColor(float h) {
    // 0.0 = Bottom (Deep Void Blue)
    // 0.5 = Middle (Cosmic Magenta)
    // 1.0 = Top (Ethereal Cyan)
    vec3 colBottom = vec3(0.1, 0.1, 0.4); // Deep Blue
    vec3 colMid = vec3(0.8, 0.2, 0.6);    // Magenta
    vec3 colTop = vec3(0.4, 0.9, 1.0);    // Cyan
    
    if (h < 0.5) {
        return mix(colBottom, colMid, h * 2.0);
    } else {
        return mix(colMid, colTop, (h - 0.5) * 2.0);
    }
}

void main() {
    // Soft circular point with atmospheric glow
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center) * 2.0;
    
    if (dist > 1.0) discard;
    
    // Soft atmospheric falloff
    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
    softCircle = pow(softCircle, 0.7);
    
    // Bright core
    float core = 1.0 - smoothstep(0.0, 0.3, dist);
    
    // Apply height-based color shift
    // Mix the star's original random color with the height theme color
    vec3 heightColor = getHeightColor(uHeight);
    vec3 finalColor = mix(vColor, heightColor, 0.6); // 60% theme color, 40% random star color
    
    // Boost brightness (Warp Speed effect brightness boost handled via vBrightness uniform if needed, but motion blur does the rest)
    vec3 coreColor = finalColor * vBrightness * 1.8 + vec3(0.2) * core;
    float alpha = softCircle * (vBrightness + 0.15);
    
    gl_FragColor = vec4(coreColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Nebula Shader - Texture-based clouds with parallax and pulse
// ─────────────────────────────────────────────────────────────────────────────
export const explorationNebulaVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const explorationNebulaFragmentShader = `
uniform sampler2D tDiffuse;
uniform float uOpacity;
uniform float uPulse;
uniform float uFadeAlpha;
uniform float uHeightIntensity;

varying vec2 vUv;

void main() {
    vec4 texColor = texture2D(tDiffuse, vUv);

    // Edge fade to blend smoothly
    float fadeX = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float fadeY = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
    float fade = fadeX * fadeY;
    fade = pow(fade, 1.3);

    // Cosmic purple/blue tint for exploration mode
    vec3 color = texColor.rgb * vec3(0.7, 0.6, 1.0);
    
    // Height-based intensity boost
    color *= (1.0 + uHeightIntensity * 0.5);

    // Pulse effect
    float pulseFactor = 1.0 + uPulse * 0.25;
    color *= pulseFactor;

    float alpha = texColor.a * uOpacity * fade * uFadeAlpha * 1.5;

    gl_FragColor = vec4(color, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Cosmic Dust Shader - Particles that drift with camera movement
// ─────────────────────────────────────────────────────────────────────────────
export const cosmicDustVertexShader = `
uniform float uTime;
uniform float uDriftX;
uniform float uDriftY;
uniform float uDensityBrightness;
uniform float uFadeAlpha;

attribute float aSize;
attribute float aRandom;
attribute float aSpeed;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Gentle floating movement
    float floatOffset = sin(uTime * aSpeed + aRandom * 10.0) * 50.0;
    pos.y += floatOffset;
    pos.x += cos(uTime * aSpeed * 0.5 + aRandom * 5.0) * 30.0;
    
    // Apply camera-based drift
    pos.x += uDriftX * (0.5 + aRandom);
    pos.y += uDriftY * (0.5 + aRandom);
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    
    // Size with attenuation
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.5, 40.0);
    
    // Pulsing alpha with density boost
    float pulse = 0.5 + 0.4 * sin(uTime * 1.2 + aRandom * 8.0);
    vAlpha = pulse * uFadeAlpha * (0.6 + uDensityBrightness * 0.4);
    
    // Ethereal blue/purple color
    float hue = 0.6 + aRandom * 0.2;
    vColor = vec3(0.5 + hue * 0.3, 0.4 + hue * 0.2, 0.8 + aRandom * 0.2);
}
`;

export const cosmicDustFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 circCoord = 2.0 * gl_PointCoord - 1.0;
    float dist = length(circCoord);
    if (dist > 1.0) discard;
    
    float alpha = (1.0 - smoothstep(0.3, 1.0, dist)) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Warp Speed Shader - Directional Motion Blur + Chromatic Aberration
// ─────────────────────────────────────────────────────────────────────────────
export const TimeDilationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.0 }, // Vignette intensity
        uTime: { value: 0.0 },
        uVelocityY: { value: 0.0 }, // Vertical velocity for blur (-1.0 to 1.0)
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
        uniform float uIntensity;
        uniform float uTime;
        uniform float uVelocityY;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            
            // ─────────────────────────────────────────────────────────────────
            // 1. Directional Motion Blur (Warp Speed)
            // ─────────────────────────────────────────────────────────────────
            float blurStrength = abs(uVelocityY) * 0.04; // Adjust scale for blur amount
            
            if (blurStrength > 0.001) {
                // Blur in Y axis only
                vec4 sum = vec4(0.0);
                float totalWeight = 0.0;
                
                // 12 samples for smooth trail
                for(float i = 0.0; i < 12.0; i+=1.0) {
                    // Sample backwards in the direction of movement
                    // If moving UP (vel > 0), trail goes DOWN (offset negative)
                    // Actually uVelocityY is usually "drag" speed. 
                    // Let's assume uVelocityY is normalized -1 to 1.
                    
                    float offset = (i / 11.0) * blurStrength * sign(uVelocityY) * -1.0; 
                    float weight = 1.0 - (i / 12.0); // Fade tail
                    
                    sum += texture2D(tDiffuse, vUv + vec2(0.0, offset)) * weight;
                    totalWeight += weight;
                }
                
                texel = sum / totalWeight;
                
                // Boost brightness during warp
                texel.rgb *= (1.0 + blurStrength * 5.0); 
            }

            // ─────────────────────────────────────────────────────────────────
            // 2. Vignette & Aberration
            // ─────────────────────────────────────────────────────────────────
            
            // Radial vignette
            vec2 uv = vUv - 0.5;
            float dist = length(uv);
            float vignette = smoothstep(0.7, 0.2, dist); // Wider vignette
            
            // Darken edges
            float darkness = uIntensity * 0.3;
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vignette);
            
            // Chromatic aberration (intensified by velocity)
            float aberration = uIntensity * 0.003 + abs(uVelocityY) * 0.01;
            if (aberration > 0.001) {
                float r = texture2D(tDiffuse, vUv + vec2(aberration, 0.0)).r;
                float b = texture2D(tDiffuse, vUv - vec2(aberration, 0.0)).b;
                texel.r = mix(texel.r, r, 0.6); // Stronger mix
                texel.b = mix(texel.b, b, 0.6);
            }
            
            gl_FragColor = texel;
        }
    `,
};

// Noise function export for particle system
export { noiseCommon };
