/**
 * Cinder Drift Theme - GLSL Shaders
 * 
 * Dramatic volcanic fire effects with central glowing core
 */

// ─────────────────────────────────────────────────────────────────────────────
// Inferno Core - Central pulsing ember/lava core
// ─────────────────────────────────────────────────────────────────────────────

export const coreVertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    uniform float time;
    uniform float intensity;
    
    void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        
        // Pulsing distortion
        vec3 pos = position;
        float pulse = sin(time * 2.0) * 0.05 * intensity;
        float wave = sin(pos.x * 3.0 + time * 2.0) * sin(pos.y * 3.0 + time * 1.5) * 0.08;
        pos += normal * (pulse + wave);
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const coreFragmentShader = `
    uniform float time;
    uniform float intensity;
    uniform vec3 colorPrimary;    // Hot orange
    uniform vec3 colorSecondary;  // Deep red
    uniform vec3 colorTertiary;   // Yellow-white (hottest)
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    // Simplex noise
    vec3 mod289(vec3 x) { return x - floor(x / 289.0) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x / 289.0) * 289.0; }
    vec4 permute(vec4 x) { return mod289((x * 34.0 + 1.0) * x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - r * 0.85373472095314; }
    
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
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }
    
    float fbm(vec3 p) {
        float f = 0.0;
        f += 0.5 * snoise(p); p *= 2.01;
        f += 0.25 * snoise(p); p *= 2.02;
        f += 0.125 * snoise(p); p *= 2.03;
        f += 0.0625 * snoise(p);
        return f;
    }
    
    void main() {
        vec3 pos = vPosition * 2.0;
        
        // Animated lava flow pattern
        float flow = fbm(pos + vec3(0.0, time * 0.3, 0.0));
        float cracks = fbm(pos * 3.0 + vec3(time * 0.1, 0.0, time * 0.15));
        
        // Hot spots that pulse
        float hotSpots = pow(max(0.0, snoise(pos * 2.0 + time * 0.5)), 2.0);
        
        // Temperature gradient (center is hottest)
        float temp = flow * 0.5 + 0.5 + hotSpots * 0.3;
        temp *= intensity;
        
        // Color mix based on temperature
        vec3 color;
        if (temp > 0.7) {
            color = mix(colorPrimary, colorTertiary, (temp - 0.7) / 0.3);
        } else if (temp > 0.4) {
            color = mix(colorSecondary, colorPrimary, (temp - 0.4) / 0.3);
        } else {
            color = colorSecondary * (temp / 0.4);
        }
        
        // Add bright veins (lava cracks)
        float veins = smoothstep(0.3, 0.5, cracks) * 0.5;
        color += colorTertiary * veins * intensity;
        
        // Fresnel glow at edges
        float fresnel = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 2.0);
        color += colorPrimary * fresnel * 0.5;
        
        // Final brightness boost
        color *= 1.0 + intensity * 0.3;
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shockwave Ring - Expanding fire ring for events
// ─────────────────────────────────────────────────────────────────────────────

export const shockwaveVertexShader = `
    uniform float time;
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const shockwaveFragmentShader = `
    uniform float time;
    uniform float opacity;
    uniform vec3 color;
    
    varying vec2 vUv;
    
    void main() {
        float dist = length(vUv - 0.5) * 2.0;
        float glow = smoothstep(1.0, 0.0, dist);
        glow *= glow;
        
        vec3 finalColor = color * (1.0 + sin(time * 10.0) * 0.2);
        gl_FragColor = vec4(finalColor, glow * opacity);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Rising Ember Particles
// ─────────────────────────────────────────────────────────────────────────────

export const emberParticleVertexShader = `
    uniform float time;
    attribute float aRandom;
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        vec3 pos = position;
        
        // Rise with time, looping
        float riseSpeed = 2.0 + aRandom * 3.0;
        float yOffset = mod(time * riseSpeed + aRandom * 20.0, 30.0) - 5.0;
        pos.y += yOffset;
        
        // Gentle horizontal drift
        pos.x += sin(time * (1.0 + aRandom) + aRandom * 10.0) * 2.0;
        pos.z += cos(time * (0.7 + aRandom * 0.5) + aRandom * 5.0) * 1.5;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size decreases as embers rise
        float normalizedY = yOffset / 25.0;
        float size = (3.0 + aRandom * 3.0) * (1.0 - normalizedY * 0.5);
        gl_PointSize = size * (200.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 15.0);
        
        // Fade out as they rise
        vAlpha = (1.0 - normalizedY) * (0.6 + aRandom * 0.4);
        
        // Color: orange to red gradient
        float colorMix = aRandom;
        vColor = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.6, 0.1), colorMix);
    }
`;

export const emberParticleFragmentShader = `
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5);
        if (dist > 0.5) discard;
        
        float glow = 1.0 - dist * 2.0;
        glow = pow(glow, 1.5);
        
        // Hot white center
        vec3 color = vColor;
        float core = smoothstep(0.25, 0.0, dist);
        color = mix(color, vec3(1.0, 0.95, 0.8), core * 0.6);
        
        gl_FragColor = vec4(color * glow, glow * vAlpha);
    }
`;
