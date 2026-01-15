/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  🔥 PYRESTORM SHADERS 🔥
 *  Custom GLSL shaders for the volcanic hellscape theme
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────────────
// Lava/Magma Surface Shader
// Uses flow map ping-pong technique for realistic fluid motion
// ─────────────────────────────────────────────────────────────────────────────
export const LAVA_VERTEX_SHADER = `
    uniform float uTime;
    uniform float uWaveHeight;
    uniform float uWaveSpeed;
    
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vDisplacement;
    
    // Simplex noise for wave displacement
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    void main() {
        vUv = uv;
        
        // Multi-octave displacement for realistic lava swells
        float noiseScale1 = 0.02;
        float noiseScale2 = 0.05;
        float timeScale = uTime * uWaveSpeed;
        
        float wave1 = snoise(position.xz * noiseScale1 + timeScale * 0.3) * 0.6;
        float wave2 = snoise(position.xz * noiseScale2 + timeScale * 0.5) * 0.3;
        float wave3 = snoise(position.xz * 0.1 + timeScale * 0.2) * 0.1;
        
        vDisplacement = (wave1 + wave2 + wave3) * uWaveHeight;
        
        vec3 pos = position;
        pos.y += vDisplacement;
        
        vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const LAVA_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    uniform float uCrustThreshold;
    uniform vec3 uCoreColor;
    uniform vec3 uCrustColor;
    uniform float uFlowSpeed;
    
    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vDisplacement;
    
    // Noise functions
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    // Flow map ping-pong technique
    vec2 flowUV(vec2 uv, vec2 flowDir, float time, float phase) {
        float progress = fract(time + phase);
        return uv - flowDir * progress;
    }
    
    void main() {
        // Flow direction from noise (simulates flow map)
        vec2 flowDir = vec2(
            snoise(vWorldPosition.xz * 0.01 + uTime * 0.1) * 0.5,
            snoise(vWorldPosition.xz * 0.01 + 100.0 + uTime * 0.1) * 0.5 + 0.3
        );
        
        float time = uTime * uFlowSpeed;
        
        // Ping-pong sampling for smooth flow
        vec2 uv1 = flowUV(vUv * 3.0, flowDir, time, 0.0);
        vec2 uv2 = flowUV(vUv * 3.0, flowDir, time, 0.5);
        
        // Triangle wave for blend weight
        float blend = abs(fract(time) - 0.5) * 2.0;
        
        // Sample noise at both phases
        float noise1 = snoise(uv1 * 5.0);
        float noise2 = snoise(uv2 * 5.0);
        float flowNoise = mix(noise1, noise2, blend);
        
        // Add detail noise layers
        float detail1 = snoise(vWorldPosition.xz * 0.08 + uTime * 0.3) * 0.5;
        float detail2 = snoise(vWorldPosition.xz * 0.15 + uTime * 0.5) * 0.25;
        
        float combinedNoise = flowNoise * 0.5 + 0.5 + detail1 + detail2;
        
        // Crust/core threshold with intensity modulation
        // Use a sharper transition for "plated" look
        float threshold = uCrustThreshold - uIntensity * 0.2;
        // Sharpen the noise to create distinct "islands" of crust
        float coreFactor = smoothstep(threshold - 0.05, threshold + 0.05, combinedNoise);
        
        // Color mixing - moderate emissive values for bloom (reduced from HDR)
        vec3 coreColorHDR = uCoreColor * (1.2 + uIntensity * 0.5);
        vec3 edgeGlow = vec3(1.0, 0.3, 0.0) * (0.8 + uIntensity * 0.3);
        
        // Create glowing cracks effect at boundary
        float edgeFactor = smoothstep(0.4, 0.5, coreFactor) - smoothstep(0.5, 0.6, coreFactor);
        
        vec3 finalColor = mix(uCrustColor, coreColorHDR, coreFactor);
        finalColor += edgeGlow * edgeFactor * 0.8;
        
        // Add pulsing glow based on displacement (reduced)
        float pulse = sin(uTime * 2.0 + vWorldPosition.x * 0.1) * 0.5 + 0.5;
        finalColor += uCoreColor * pulse * coreFactor * 0.1 * uIntensity;
        
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Ember Particle Shader
// GPU-driven particles with temperature decay
// ─────────────────────────────────────────────────────────────────────────────
export const EMBER_VERTEX_SHADER = `
    uniform float uTime;
    uniform float uSize;
    uniform float uIntensity;
    
    attribute float aLife;
    attribute float aRandom;
    attribute float aSpeed;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        vLife = aLife;
        vRandom = aRandom;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Size based on life and random factor
        float lifeFactor = smoothstep(0.0, 0.2, aLife) * smoothstep(1.0, 0.8, aLife);
        float baseSize = uSize * (0.5 + aRandom * 0.5);
        
        gl_PointSize = baseSize * lifeFactor * (300.0 / -mvPosition.z) * (1.0 + uIntensity * 0.5);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const EMBER_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    
    varying float vLife;
    varying float vRandom;
    
    void main() {
        // Circular particle shape
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        
        // Soft edge
        float alpha = 1.0 - smoothstep(0.2, 0.5, dist);
        alpha *= vLife;
        
        // Temperature-based color: white-hot -> orange -> red -> grey
        vec3 whiteHot = vec3(1.0, 1.0, 0.9);
        vec3 orange = vec3(1.0, 0.4, 0.0);
        vec3 red = vec3(0.8, 0.1, 0.0);
        vec3 ash = vec3(0.2, 0.15, 0.1);
        
        vec3 color;
        if (vLife > 0.7) {
            color = mix(orange, whiteHot, (vLife - 0.7) / 0.3);
        } else if (vLife > 0.3) {
            color = mix(red, orange, (vLife - 0.3) / 0.4);
        } else {
            color = mix(ash, red, vLife / 0.3);
        }
        
        // HDR boost for bloom (reduced to prevent overexposure)
        color *= (1.0 + uIntensity * 0.3 + vLife * 0.5);
        
        // Flicker effect
        float flicker = sin(uTime * 20.0 + vRandom * 100.0) * 0.2 + 0.8;
        color *= flicker;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Smoke Billboard Shader
// Soft particles with depth-based fade
// ─────────────────────────────────────────────────────────────────────────────
export const SMOKE_VERTEX_SHADER = `
    uniform float uTime;
    
    attribute float aLife;
    attribute float aScale;
    attribute float aRotation;
    
    varying float vLife;
    varying float vRotation;
    varying vec2 vUv;
    
    void main() {
        vLife = aLife;
        vRotation = aRotation + uTime * 0.1;
        vUv = uv;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const SMOKE_FRAGMENT_SHADER = `
    uniform float uTime;
    
    varying float vLife;
    varying float vRotation;
    varying vec2 vUv;

    // Simplex noise for organic smoke shape
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
    
    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
        m = m * m;
        m = m * m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    void main() {
        // Rotate UVs
        vec2 center = vUv - 0.5;
        float c = cos(vRotation);
        float s = sin(vRotation);
        vec2 rotatedUv = vec2(
            center.x * c - center.y * s,
            center.x * s + center.y * c
        ) + 0.5;
        
        // Organic noise shape
        // Scale UVs for noise lookup
        float n = snoise(rotatedUv * 4.0 + vec2(0.0, uTime * 0.2));
        
        // Circular falloff combined with noise
        float dist = length(center) * 2.0;
        
        // Erode edges with noise
        float mask = 1.0 - smoothstep(0.4 + n * 0.2, 0.8 + n * 0.2, dist);
        
        // Core density
        float alpha = mask * vLife * 0.4;
        
        if (alpha < 0.01) discard;
        
        // Dark smoke color with slight red tint from lava glow
        vec3 smokeColor = vec3(0.05, 0.03, 0.02);
        vec3 glowTint = vec3(0.15, 0.05, 0.0) * (1.0 - vLife);
        
        gl_FragColor = vec4(smokeColor + glowTint, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Volcanic Skybox Shader
// Dark hellscape sky with pulsing fire glow
// ─────────────────────────────────────────────────────────────────────────────
export const SKY_VERTEX_SHADER = `
    varying vec3 vWorldPosition;
    
    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const SKY_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    
    varying vec3 vWorldPosition;
    
    // Smooth Volcanic Nebula (No grain)
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
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
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
        vec3 dir = normalize(vWorldPosition);
        float height = dir.y;
        
        // Base Gradient: Warm Sunset -> Void
        vec3 magma = vec3(0.6, 0.1, 0.0);    // Orange Horizon
        vec3 mid   = vec3(0.08, 0.02, 0.04); // Dark Purple/Red
        vec3 space = vec3(0.005, 0.002, 0.015); // Deep Void
        
        vec3 color = mix(magma, mid, smoothstep(-0.2, 0.3, height));
        color = mix(color, space, smoothstep(0.3, 0.8, height));
        
        // Large-scale smooth Nebula clouds
        float n = snoise(dir * 2.0 + uTime * 0.03);
        float clouds = smoothstep(0.3, 0.8, n);
        vec3 nebulaColor = vec3(0.2, 0.0, 0.12); // Deep Magenta nebulae
        color = mix(color, nebulaColor + color, clouds * 0.4);
        
        // Soft Starfield (Smooth noise blobs, not single pixels)
        float s = snoise(dir * 50.0);
        float stars = smoothstep(0.96, 0.99, s);
        color += vec3(stars) * (1.0 - height * 0.6); // Fade stars towards horizon
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Mountain Silhouette Shader
// Dark volcanic mountains with rim lighting
// ─────────────────────────────────────────────────────────────────────────────
export const MOUNTAIN_VERTEX_SHADER = `
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vNoise;
    
    float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vNormal = normalize(normalMatrix * normal);
        
        // Jagged displacement in vertex shader
        vec3 pos = position;
        float noise = rand(position.xz) * 0.5 + 0.5;
        vNoise = noise; // Pass to fragment
        
        // Spiky extrusion based on normal direction
        pos += normal * noise * 30.0; 
        
        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPos.xyz;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const MOUNTAIN_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uRimColor;
    
    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vNoise; // Passed from vertex for consistency
    
    // Simplex noise for rock texture
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
    
    float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
        
        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 = v - i + dot(i, C.xxx) ;
        
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        
        i = mod289(i); 
        vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
           
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
        
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;
        
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                      dot(p2,x2), dot(p3,x3) ) );
    }

    void main() {
        // Rock surface detail
        float rockNoise = snoise(vWorldPosition * 0.015 + vNoise * 0.1);
        float fineNoise = snoise(vWorldPosition * 0.08);
        
        // Base volcanic rock color (dark grey/black)
        vec3 rockColor = vec3(0.08, 0.07, 0.08);
        
        // Add rock texture variation
        rockColor += vec3(0.03) * rockNoise;
        rockColor -= vec3(0.02) * fineNoise;
        
        // === LAVA RIVERS (Canales) ===
        // Use polar coordinates for radial flow
        // GUARD: Add epsilon to avoid atan(0,0) undefined at center
        float angle = atan(vWorldPosition.z, vWorldPosition.x + 0.0001);
        float radius = length(vWorldPosition.xz);
        
        // 1. Channel shape (River beds)
        // Angular noise creates the river paths around the mountain
        // Increased frequency (15.0) for more branching rivers
        float riverPath = snoise(vec3(angle * 15.0, radius * 0.003, 0.0)); 
        float riverDetail = snoise(vec3(angle * 30.0, radius * 0.01 + uTime * 0.1, 0.0));
        float riverMask = riverPath + riverDetail * 0.4;
        
        // Threshold to create distinct channels (Wider and clearer)
        float riverIntensity = smoothstep(0.4, 0.65, riverMask);
        
        // 2. Flow Animation
        // Noise flowing ALONG the radius (down the mountain)
        float flowNoise = snoise(vec3(angle * 10.0, radius * 0.02 - uTime * 0.8, uTime * 0.2));
        
        // Combine channel mask with flow texture
        float lavaRiver = riverIntensity * (0.8 + 0.5 * flowNoise);
        
        // 3. Masking
        // Fade out near bottom (extend much further onto ground plain)
        float bottomFade = 1.0 - smoothstep(10000.0, 15000.0, radius);
        // Start from near rim (radius ~250)
        float topFade = smoothstep(220.0, 300.0, radius);
        
        // Combine masks
        lavaRiver *= bottomFade * topFade;
        
        // --- Magma Texture Logic ---
        // High frequency noise for "floating" crust details
        float crustMap = snoise(vWorldPosition * 0.15 + vec3(uTime * 0.15, 0.0, 0.0));
        // Create dark chunks (crust) floating in the stream
        float crustFactor = smoothstep(0.1, 0.7, crustMap);

        // Core colors
        vec3 magmaBright = vec3(3.0, 1.0, 0.2); // Hot liquid (HDR)
        vec3 magmaDark   = vec3(1.1, 0.1, 0.0); // Cooling liquid
        vec3 crustRock   = vec3(0.1, 0.02, 0.0); // Solid black/red chunks

        // 1. Base Gradient (Center is hotter)
        vec3 flowColor = mix(magmaDark, magmaBright, riverIntensity);
        
        // 2. Apply Crust (Dark spots)
        // Crust appears more in the slower/cooler areas, but we mix it everywhere for texture
        vec3 finalLavaColor = mix(flowColor, crustRock, crustFactor * 0.7); 

        vec3 riverColor = finalLavaColor * lavaRiver;
        
        // Veins overlay (thin cracks) - Reduce these to be very subtle
        float crackNoise = snoise(vWorldPosition * 0.02);
        float crk = 1.0 - smoothstep(0.0, 0.1, abs(crackNoise));
        vec3 veins = vec3(0.5, 0.1, 0.0) * crk * (1.0 - lavaRiver) * 0.2; // Only where no river

        // Lighting
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 normal = normalize(vNormal + fineNoise * 0.15);
        
        float height = vWorldPosition.y;
        
        // Subtle crater glow
        float lavaGlowFactor = 1.0 - smoothstep(-100.0, 400.0, height);
        vec3 subtleGlow = vec3(0.15, 0.04, 0.0) * lavaGlowFactor * 0.2;

        // Rim Light
        float rimParam = 1.0 - max(0.0, dot(viewDir, normal));
        vec3 rimColor = uRimColor * pow(rimParam, 4.0) * 0.5;
        
        // Combine
        vec3 finalColor = rockColor;
        finalColor += riverColor;     // Add flowing rivers
        finalColor += veins;          // Subtle cracks elsewhere
        finalColor += subtleGlow;
        finalColor += rimColor;
        


        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lightning Bolt Shader
// Bright electrical discharge effect
// ─────────────────────────────────────────────────────────────────────────────
export const LIGHTNING_VERTEX_SHADER = `
    attribute float aProgress;
    
    varying float vProgress;
    
    void main() {
        vProgress = aProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const LIGHTNING_FRAGMENT_SHADER = `
    uniform float uLife;
    uniform float uWidth;
    
    varying float vProgress;
    
    void main() {
        // Core bright white, edges blue-white
        vec3 coreColor = vec3(1.0, 1.0, 1.0) * 5.0;  // HDR white
        vec3 edgeColor = vec3(0.7, 0.8, 1.0) * 3.0;  // HDR blue-white
        
        vec3 color = mix(edgeColor, coreColor, 1.0 - vProgress);
        
        float alpha = uLife;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Heat Distortion Post-Process Shader
// Screen-space refraction for heat haze effect
// ─────────────────────────────────────────────────────────────────────────────
export const HEAT_DISTORTION_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uDistortionStrength: { value: 0.01 },
        uIntensity: { value: 0 },
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
        uniform float uDistortionStrength;
        uniform float uIntensity;
        
        varying vec2 vUv;
        
        void main() {
            // Heat rises from bottom
            float heatMask = 1.0 - smoothstep(0.0, 0.6, vUv.y);
            
            // Wavy distortion
            float wave1 = sin(vUv.x * 30.0 + uTime * 2.0) * 0.5;
            float wave2 = sin(vUv.x * 50.0 + uTime * 3.0) * 0.3;
            float wave3 = sin(vUv.y * 20.0 + uTime * 1.5) * 0.2;
            
            vec2 distortion = vec2(
                (wave1 + wave2) * uDistortionStrength,
                wave3 * uDistortionStrength * 0.5
            ) * heatMask * (1.0 + uIntensity);
            
            vec4 color = texture2D(tDiffuse, vUv + distortion);
            
            gl_FragColor = color;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Post-Process Shader
// ─────────────────────────────────────────────────────────────────────────────
export const VIGNETTE_SHADER = {
    uniforms: {
        tDiffuse: { value: null },
        uDarkness: { value: 0.4 },
        uOffset: { value: 1.0 },
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
        uniform float uDarkness;
        uniform float uOffset;

        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(uOffset, uOffset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - uDarkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Volumetric Smoke Plume Shader
// Towering smoke column rising from crater with lava-lit base
// ─────────────────────────────────────────────────────────────────────────────
export const SMOKE_PLUME_VERTEX_SHADER = `
    uniform float uTime;
    uniform float uIntensity;

    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vHeight;

    void main() {
        vUv = uv;

        vec3 pos = position;

        // Height-based expansion (wider at top)
        float heightFactor = pos.y / 800.0; // Normalize to plume height
        vHeight = heightFactor;

        // Turbulent displacement increases with height
        float turbulence = heightFactor * 80.0;
        float twist = sin(pos.y * 0.005 + uTime * 0.5) * turbulence;
        float sway = cos(pos.y * 0.003 + uTime * 0.3) * turbulence * 0.5;

        pos.x += twist + sin(uTime * 0.7 + pos.y * 0.01) * 20.0 * heightFactor;
        pos.z += sway + cos(uTime * 0.5 + pos.y * 0.008) * 15.0 * heightFactor;

        // Expand radius with height
        float expansion = 1.0 + heightFactor * 2.5;
        pos.x *= expansion;
        pos.z *= expansion;

        vec4 worldPos = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPos.xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const SMOKE_PLUME_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uLavaGlowColor;
    uniform vec3 uSmokeColor;

    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vHeight;

    // 3D Simplex noise
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
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
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
        // Multi-octave noise for volumetric look
        vec3 noiseCoord = vWorldPosition * 0.008 + vec3(0.0, -uTime * 0.15, 0.0);
        float noise1 = snoise(noiseCoord) * 0.5 + 0.5;
        float noise2 = snoise(noiseCoord * 2.0 + 100.0) * 0.25 + 0.5;
        float noise3 = snoise(noiseCoord * 4.0 + 200.0) * 0.125 + 0.5;
        float combinedNoise = noise1 * noise2 * noise3;

        // Radial falloff from center
        vec2 centered = vUv - 0.5;
        float radialDist = length(centered) * 2.0;

        // Erode edges with noise for organic shape
        float edgeNoise = snoise(vec3(vUv * 8.0, uTime * 0.3));
        float edgeMask = 1.0 - smoothstep(0.3 + edgeNoise * 0.15, 0.7 + edgeNoise * 0.1, radialDist);

        // Density varies with noise
        float density = combinedNoise * edgeMask;

        // Height-based fade (thinner at top)
        float heightFade = 1.0 - smoothstep(0.6, 1.0, vHeight);
        density *= heightFade;

        // Bottom fade (starts above crater)
        float bottomFade = smoothstep(0.0, 0.15, vHeight);
        density *= bottomFade;

        // Color: lava glow at base, dark smoke at top
        vec3 lavaGlow = uLavaGlowColor * (2.0 + uIntensity);
        float glowFactor = (1.0 - vHeight) * (1.0 - vHeight);
        vec3 color = mix(uSmokeColor, lavaGlow, glowFactor * 0.6);

        // Add internal glow variation
        float internalGlow = snoise(vWorldPosition * 0.02 + vec3(0.0, -uTime * 0.2, 0.0));
        internalGlow = smoothstep(0.3, 0.7, internalGlow);
        color += lavaGlow * internalGlow * glowFactor * 0.3;

        // Alpha based on density
        float alpha = density * 0.5 * (0.8 + uIntensity * 0.2);

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lava Bubbles Shader (overlay on lava surface)
// Animated bubble domes and boiling hotspots
// ─────────────────────────────────────────────────────────────────────────────
export const LAVA_BUBBLES_VERTEX_SHADER = `
    uniform float uTime;

    varying vec2 vUv;
    varying vec3 vWorldPosition;

    void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const LAVA_BUBBLES_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uCoreColor;

    varying vec2 vUv;
    varying vec3 vWorldPosition;

    // Hash functions for random bubble placement
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    vec2 hash2(vec2 p) {
        return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
    }

    // Animated bubble function
    float bubble(vec2 uv, vec2 center, float radius, float phase) {
        float dist = length(uv - center);

        // Bubble lifecycle: grow -> pop
        float life = fract(uTime * 0.15 + phase);
        float grow = smoothstep(0.0, 0.7, life);
        float pop = 1.0 - smoothstep(0.85, 1.0, life);
        float scale = grow * pop;

        float r = radius * scale;
        if (dist > r) return 0.0;

        // Dome shape with bright rim
        float dome = 1.0 - (dist / r);
        dome = pow(dome, 0.5);

        // Bright ring at edge (surface tension)
        float ring = smoothstep(0.6, 0.9, dist / r) * pop;

        return dome * 0.6 + ring * 1.5;
    }

    // Hotspot pulse function
    float hotspot(vec2 uv, vec2 center, float phase) {
        float dist = length(uv - center);
        float pulse = sin(uTime * 3.0 + phase * 6.28) * 0.5 + 0.5;
        float radius = 0.03 + pulse * 0.02;
        float glow = 1.0 - smoothstep(0.0, radius, dist);
        return glow * glow * (0.5 + pulse * 0.5);
    }

    void main() {
        vec2 uv = vWorldPosition.xz * 0.005; // Scale to world space

        float bubbleIntensity = 0.0;
        float hotspotIntensity = 0.0;

        // Generate multiple bubbles in a grid pattern with random offsets
        for (float y = -2.0; y <= 2.0; y += 1.0) {
            for (float x = -2.0; x <= 2.0; x += 1.0) {
                vec2 cell = vec2(x, y);
                vec2 cellHash = hash2(cell + floor(uTime * 0.1));

                // Bubble position within cell
                vec2 bubblePos = cell + cellHash * 0.8 - 0.4;
                float bubblePhase = hash(cell);
                float bubbleRadius = 0.08 + cellHash.x * 0.12;

                bubbleIntensity += bubble(uv, bubblePos, bubbleRadius, bubblePhase);

                // Hotspots (fewer, more random)
                if (cellHash.y > 0.6) {
                    hotspotIntensity += hotspot(uv, bubblePos + cellHash * 0.3, bubblePhase);
                }
            }
        }

        // Combine effects
        float totalIntensity = bubbleIntensity + hotspotIntensity * 2.0;
        totalIntensity *= (1.0 + uIntensity * 0.5);

        // Color: bright orange/yellow for bubbles
        vec3 bubbleColor = uCoreColor * 2.5;
        vec3 hotspotColor = vec3(1.0, 0.9, 0.5) * 3.0; // White-hot

        vec3 color = mix(bubbleColor, hotspotColor, hotspotIntensity / (totalIntensity + 0.001));

        float alpha = min(1.0, totalIntensity * 0.8);

        if (alpha < 0.01) discard;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// God Rays / Volumetric Light Shaft Shader
// Light beams emanating from crater
// ─────────────────────────────────────────────────────────────────────────────
export const GOD_RAYS_VERTEX_SHADER = `
    uniform float uTime;

    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vAngle;

    void main() {
        vUv = uv;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;

        // Calculate angle from center for ray variation
        vAngle = atan(position.x, position.z);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const GOD_RAYS_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uRayColor;
    uniform float uRayDensity;

    varying vec2 vUv;
    varying vec3 vWorldPosition;
    varying float vAngle;

    // Simple noise for ray variation
    float hash(float n) { return fract(sin(n) * 43758.5453); }

    float noise(float x) {
        float i = floor(x);
        float f = fract(x);
        float u = f * f * (3.0 - 2.0 * f);
        return mix(hash(i), hash(i + 1.0), u);
    }

    void main() {
        // Height factor (rays fade with height)
        float height = vWorldPosition.y;
        float heightFade = 1.0 - smoothstep(100.0, 600.0, height);
        heightFade = pow(heightFade, 0.5);

        // Radial distance from center
        float radialDist = length(vWorldPosition.xz);
        float radialFade = 1.0 - smoothstep(50.0, 300.0, radialDist);

        // Create ray pattern based on angle
        float rayCount = uRayDensity;
        float rayAngle = vAngle * rayCount;

        // Animated ray rotation
        rayAngle += uTime * 0.1;

        // Ray intensity with noise variation
        float rayPattern = sin(rayAngle) * 0.5 + 0.5;
        rayPattern = pow(rayPattern, 3.0); // Sharpen rays

        // Add noise for organic feel
        float rayNoise = noise(vAngle * 10.0 + uTime * 0.5);
        rayPattern *= 0.7 + rayNoise * 0.3;

        // Shimmer effect
        float shimmer = sin(height * 0.05 + uTime * 2.0) * 0.1 + 0.9;

        // Combine all factors
        float intensity = rayPattern * heightFade * radialFade * shimmer;
        intensity *= (0.3 + uIntensity * 0.7);

        // Dust particles in rays
        float dust = noise(vWorldPosition.y * 0.1 + vAngle * 5.0 + uTime);
        dust = smoothstep(0.6, 0.9, dust) * 0.3;
        intensity += dust * heightFade;

        // Color: warm orange glow
        vec3 color = uRayColor * (1.5 + uIntensity);

        // Add slight color variation with height
        color = mix(color, vec3(1.0, 0.8, 0.5), heightFade * 0.2);

        float alpha = intensity * 0.4;

        if (alpha < 0.005) discard;

        gl_FragColor = vec4(color, alpha);
    }
`;
