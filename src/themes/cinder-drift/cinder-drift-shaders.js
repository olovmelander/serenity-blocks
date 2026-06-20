/**
 * Cinder Drift - Custom Shaders
 * High-fidelity visual effects for the volcanic core theme
 */

// =========================================================================================
// 1. MAGMA BACKGROUND SHADER
// Flowing, multi-layered lava with crust and heat distortion
// =========================================================================================

export const magmaBackgroundVertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;

    void main() {
        vUv = uv;
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const magmaBackgroundFragmentShader = `
    uniform float time;
    uniform vec3 colorPrimary;   // Dark crust: #1a0500
    uniform vec3 colorSecondary; // Magma red: #ff4400
    uniform vec3 colorTertiary;  // Bright yellow/white: #ffcc00
    
    // Explosion Uniforms
    uniform vec2 explosionCenter;   // UV coords of explosion (0-1)
    uniform float explosionProgress; // 0-1 animation
    uniform float explosionIntensity; // Strength of distortion
    
    varying vec2 vUv;
    varying vec3 vPosition;

    // --- Noise Functions ---
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m ;
        m = m*m ;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    // FBM
    float fbm(vec2 x) {
        float v = 0.0;
        float a = 0.5;
        vec2 shift = vec2(100.0);
        mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
        for (int i = 0; i < 6; ++i) { // Reduced from 8 to 6 to balance detail/noise
            v += a * snoise(x);
            x = rot * x * 2.0 + shift;
            a *= 0.5;
        }
        return v;
    }

    void main() {
        vec2 uv = vUv * 1.5; // Increased scale for higher resolution feel
        float t = time * 0.15;
        
        // Separate UV for flow (moves) vs logic (static)
        // User request: "combo effect drifted away" -> Fix: Don't scroll the coordinate system used for interaction!
        vec2 flowUv = uv + vec2(time * 0.015, time * 0.005);
        
        // =============================
        // EXPLOSION RIPPLE DISTORTION
        // =============================
        // Use static 'uv' for distance so explosion stays fixed on screen
        float distToCenter = distance(uv, explosionCenter);
        
        // Ripple wave spreads outward - larger radius for full coverage
        float waveRadius = explosionProgress * 1.5; 
        float waveFront = waveRadius;
        float waveWidth = 0.15; 
        
        // Global fade: stays strong then fades out completely at the end
        float fade = 1.0 - smoothstep(0.5, 1.0, explosionProgress);

        // Create ripple ring
        float ripple = smoothstep(waveFront - waveWidth, waveFront, distToCenter) 
                     - smoothstep(waveFront, waveFront + waveWidth, distToCenter);
        ripple *= explosionIntensity * fade;
        
        // Secondary ripples behind the main wave
        float ripple2 = sin((distToCenter - waveRadius * 0.7) * 30.0) * 0.5 + 0.5;
        ripple2 *= smoothstep(waveFront, 0.0, distToCenter); // Only inside the wave
        ripple2 *= explosionIntensity * fade * 0.5;
        
        // Distort UV based on ripple (push outward from center) - SHOCKWAVE
        // This simulates the fluid mass being physically shoved outward
        float shockwave = smoothstep(waveRadius - 0.2, waveRadius, distToCenter) * 
                          (1.0 - smoothstep(waveRadius, waveRadius + 0.1, distToCenter));
        
        // Calculate direction relative to static center
        vec2 dir = normalize(uv - explosionCenter + 0.0001);
        
        // Displace UVs AWAY from center to look like material is being pushed
        vec2 fluidDisplacement = dir * shockwave * 0.3 * explosionIntensity * fade;
        
        // Apply shockwave displacement to the FLOW uv, so the lava texture gets shoved
        flowUv -= fluidDisplacement; 
        
        // =============================
        // ORIGINAL FBM FLUID
        // =============================
        vec2 q = vec2(0.);
        q.x = fbm(flowUv + 0.00 * t);
        q.y = fbm(flowUv + vec2(1.0));

        vec2 r = vec2(0.);
        r.x = fbm(flowUv + 1.0 * q + vec2(1.7, 9.2) + 0.15 * t);
        r.y = fbm(flowUv + 1.0 * q + vec2(8.3, 2.8) + 0.126 * t);

        float f = fbm(flowUv + r);
        
        // Add explosion "heat" boost in affected area
        float heatBoost = smoothstep(waveRadius + 0.1, 0.0, distToCenter) * explosionIntensity * fade;

        // 2. Calculate Normal for 3D Lighting (Bump Mapping)
        float h = f + ripple * 0.5 + heatBoost * 0.3; // Add ripple to height
        vec2 dxy = vec2(dFdx(h), dFdy(h));
        vec3 normal = normalize(vec3(-dxy * 9.0, 1.0)); // Reduced from 20.0 to reduce noise

        // 3. Lighting
        vec3 lightDir = normalize(vec3(-0.5, 0.5, 1.0));
        float diff = max(dot(normal, lightDir), 0.0);
        float spec = pow(max(dot(reflect(-lightDir, normal), vec3(0,0,1)), 0.0), 32.0);

        // 4. Color Mixing (Contrast Boost)
        vec3 color = colorPrimary; // Dark crust base
        
        // Add red lava veins - use power function to create sharper "channels"
        float flow1 = clamp(length(q), 0.0, 1.0);
        color = mix(color, colorSecondary, pow(flow1, 2.5)); // More black/red separation
        
        // Add brightest highlights only in hottest spots (significantly reduced yellow)
        float flow2 = clamp(length(r.x), 0.0, 1.0);
        color = mix(color, colorTertiary, pow(flow2, 5.0)); // Sharp transition to yellow only at peaks
        
        // Extra hot spots
        color = mix(color, vec3(1.0, 1.0, 0.8), pow(length(r.x), 8.0) * 0.4);
        
        // Add bright hot glow at explosion center
        vec3 explosionGlow = vec3(1.0, 0.9, 0.5) * heatBoost * 1.0;
        color += explosionGlow;
        
        // Add rim glow on ripple
        color += vec3(1.0, 0.5, 0.1) * ripple * 0.4;
        
        color *= (0.8 + 0.5 * diff); 
        color += spec * 0.3 * vec3(1.0, 0.8, 0.5);

        // Vignette
        float dist = distance(vUv, vec2(0.5));
        color *= smoothstep(0.8, 0.2, dist);

        gl_FragColor = vec4(color, 1.0);
    }
`;

// =========================================================================================
// 2. VOLCANIC ROCK SHADER (REPLACES CORES)
// Cracked rock with emissive glowing interior
// =========================================================================================

export const rockVertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    
    uniform float time;
    
    // Displacement noise
    float hash(float n) { return fract(sin(n) * 1e4); }
    float noise(vec3 x) {
        const vec3 step = vec3(110, 241, 171);
        vec3 i = floor(x);
        vec3 f = fract(x);
        float n = dot(i, step);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(n + dot(step, vec3(0, 0, 0))), hash(n + dot(step, vec3(1, 0, 0))), u.x),
                       mix(hash(n + dot(step, vec3(0, 1, 0))), hash(n + dot(step, vec3(1, 1, 0))), u.x), u.y),
                   mix(mix(hash(n + dot(step, vec3(0, 0, 1))), hash(n + dot(step, vec3(1, 0, 1))), u.x),
                       mix(hash(n + dot(step, vec3(0, 1, 1))), hash(n + dot(step, vec3(1, 1, 1))), u.x), u.y), u.z);
    }

    void main() {
        vUv = uv;
        vNormal = normalMatrix * normal;
        
        // Use low frequency noise for general "blob" shape deformation
        float largeShape = noise(position * 0.5 + time * 0.02) * 1.5;
        
        // Use high frequency for surface roughness
        float detail = noise(position * 3.0) * 0.2;
        
        float displacement = largeShape + detail;
        vec3 newPos = position + normal * displacement;
        
        vPosition = newPos;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(newPos, 1.0);
    }
`;

export const rockFragmentShader = `
    uniform float time;
    uniform vec3 baseColor; // Dark rock
    uniform vec3 glowColor; // Magma
    uniform float glowIntensity;
    
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;

    // --- UTILS ---
    vec3 mod289_v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289_v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289_v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    
    vec3 permute_v3(vec3 x) { return mod289_v3(((x*34.0)+1.0)*x); }
    vec4 permute_v4(vec4 x) { return mod289_v4(((x*34.0)+1.0)*x); }
    
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    // Simplex Noise (using unique names)
    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        // Uses v3
        i = mod289_v3(i);
        // Uses v4
        vec4 p = permute_v4( permute_v4( permute_v4( 
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

    // Simple veiny noise for cracks - uses snoise
    float veinNoise(vec3 p) {
        return 1.0 - abs(snoise(p)); // Sharp creases
    }

    void main() {
        // Create "Basalt Plates" look using domain warped noise
        // Warping
        vec3 q = vPosition * 2.0;
        float warp = snoise(q * 0.5 + time * 0.1);
        q += warp * 0.5;
        
        // Cracks: Sharp ridges
        float crack = veinNoise(q * 3.0);
        crack = pow(crack, 3.0); // Sharpen lines
        
        // Threshold for magma
        // High values = Magma (Cracks), Low = Rock
        float magmaMask = smoothstep(0.6, 0.7, crack);
        
        // Rock Surface Texture
        float rockGrain = snoise(vPosition * 15.0) * 0.1;
        vec3 rockCol = baseColor + vec3(rockGrain);
        
        // Rim lighting
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float rim = 1.0 - dot(viewDir, normalize(vNormal));
        rim = smoothstep(0.4, 0.8, rim) * 0.5;
        
        // Pulse
        float pulse = 0.8 + 0.3 * sin(time * 2.0);
        
        // Magma color: Hot core (White) -> Red -> Rock
        vec3 hearthColor = mix(glowColor, vec3(1.0, 1.0, 0.5), crack); // Brighten center
        
        vec3 finalColor = mix(rockCol, hearthColor * pulse * 2.0, magmaMask);
        
        // Add minimal rim to rock parts
        finalColor += glowColor * rim * (1.0 - magmaMask);
        
        gl_FragColor = vec4(finalColor * glowIntensity, 1.0);
    }
`;

// =========================================================================================
// 3. SMOKE PARTICLES
// Soft, scrolling smoke texture
// =========================================================================================

export const smokeVertexShader = `
    uniform float time;
    varying vec2 vUv;
    varying float vAlpha;

    attribute float size;
    attribute float offset;
    
    void main() {
        vUv = uv;
        
        vec3 pos = position;
        
        // Drift up
        pos.y += time * 0.5;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = size * (300.0 / -mvPosition.z);
        
        // Fade in/out cycle
        vAlpha = 0.5 + 0.5 * sin(time * 0.5 + offset);
    }
`;

export const smokeFragmentShader = `
// uniform sampler2D map;
    uniform vec3 color;
    varying vec2 vUv;
    varying float vAlpha;
    
    void main() {
        vec2 uv = gl_PointCoord;
        
        // Soft circle
        float dist = length(uv - 0.5);
        float alpha = smoothstep(0.5, 0.0, dist);
        
        // Smoky noise texture could be sampled here, or just procedural
        // Simple procedural smoke for now
        
        gl_FragColor = vec4(color, alpha * vAlpha * 0.3);
    }
`;

// =========================================================================================
// 4. INSTANCED EMBER SHADER
// High performance sparks with curl noise movement
// =========================================================================================

export const emberVertexShader = `
    attribute float size;
    attribute vec3 velocity;
    attribute float life;
    attribute float maxLife;
    attribute float offset;
    
    uniform float time;
    
    varying float vLife;
    varying float vAlpha;
    varying vec3 vColor;
    
    // Curl noise function for turbulence
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
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

    vec3 curlNoise(vec3 p) {
        const float e = 0.1;
        vec3 dx = vec3(e, 0.0, 0.0);
        vec3 dy = vec3(0.0, e, 0.0);
        vec3 dz = vec3(0.0, 0.0, e);
        
        vec3 p_x0 = snoise(p - dx) * vec3(1.0);
        vec3 p_x1 = snoise(p + dx) * vec3(1.0);
        vec3 p_y0 = snoise(p - dy) * vec3(1.0);
        vec3 p_y1 = snoise(p + dy) * vec3(1.0);
        vec3 p_z0 = snoise(p - dz) * vec3(1.0);
        vec3 p_z1 = snoise(p + dz) * vec3(1.0);
        
        float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
        float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
        float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;
        
        return normalize(vec3(x, y, z));
    }

    void main() {
        // Calculate animated position
        float age = mod(time + offset, maxLife);
        vLife = 1.0 - (age / maxLife);
        
        // Upward movement + Turbulence
        vec3 pos = position + velocity * age;
        
        // Add curl noise turbulence
        vec3 curl = curlNoise(pos * 0.1 + time * 0.2) * 5.0 * (age / maxLife);
        pos += curl;

        // Reset if age wraps ( handled by modulo above, but let's reset visual start)
        // Ideally we reset in JS, but for pure shader loop:
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size attenuation
        gl_PointSize = size * (200.0 / -mvPosition.z) * vLife;
        
        vAlpha = smoothstep(0.0, 0.2, age) * smoothstep(1.0, 0.7, age);
        vColor = mix(vec3(1.0, 0.8, 0.0), vec3(1.0, 0.2, 0.0), age / maxLife);
    }
`;

export const emberFragmentShader = `
    varying float vLife;
    varying float vAlpha;
    varying vec3 vColor;
    
    void main() {
        vec2 uv = gl_PointCoord;
        float dist = length(uv - 0.5);

        if (dist > 0.5) discard;

        // Glowy center
        float strength = 1.0 - (dist * 2.0);
        strength = pow(strength, 2.0);

        // Write the output (was missing — left the fragment shader with no color
        // output, which floods WebGL with "missing fragment shader outputs" and
        // leaves the embers invisible). vAlpha is the per-particle age fade.
        gl_FragColor = vec4(vColor, strength * vAlpha);
    }
`;

// =============================================================================
// GPU BURST PARTICLE SHADERS
// =============================================================================

export const gpuBurstVertexShader = `
    uniform float uTime;
    uniform float uStartTime;
    uniform float uIntensity;

    attribute vec3 velocity;
    attribute float life;
    attribute float size;
    attribute vec3 color;
    
    varying vec3 vColor;
    varying float vLife;
    
    void main() {
        float age = uTime - uStartTime;
        vLife = 1.0 - (age / life);
        
        if (vLife <= 0.0 || age < 0.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // Move off-clip
            return;
        }
        
        vColor = color;
        
        // Physics on GPU
        // Scale velocity by intensity
        vec3 pos = position + (velocity * uIntensity) * age;
        
        // Gravity
        pos.y -= 15.0 * age * age; // Parabolic gravity
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        // Size attenuation - also scaled by intensity
        gl_PointSize = (size * uIntensity) * (300.0 / -mvPosition.z) * vLife;
    }
`;

export const gpuBurstFragmentShader = `
    varying vec3 vColor;
    varying float vLife;
    
    void main() {
        if (vLife <= 0.0) discard;
        
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        
        if (dist > 0.5) discard;
        
        // Soft glow look
        float glow = 1.0 - (dist * 2.0);
        glow = pow(glow, 1.5);
        
        gl_FragColor = vec4(vColor, glow * vLife);
    }
`;
