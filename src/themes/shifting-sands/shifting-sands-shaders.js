/**
 * Shifting Sands Theme - ARRAKIS GLSL Shaders
 * Inspired by Dune - Harsh desert planet aesthetics
 */

// ============== SKY SHADERS (Arrakis Orange/Amber) ==============

export const starsVertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aColor;
    varying vec3 vColor;
    varying float vAlpha;
    uniform float uTime;

    void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mvPosition.z);
        
        // Twinkle
        float twinkle = 0.5 + 0.5 * sin(uTime * 2.0 + aPhase * 10.0);
        vAlpha = twinkle;
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const starsFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;
        
        float glow = 1.0 - (dist * 2.0);
        glow = pow(glow, 1.5);
        
        gl_FragColor = vec4(vColor, vAlpha * glow);
    }
`;

export const skyVertexShader = `
    varying vec3 vWorldPosition;

    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const skyFragmentShader = `
    uniform vec3 uTopColor;
    uniform vec3 uMidColor;
    uniform vec3 uBottomColor;
    uniform vec3 uHorizonColor;
    uniform float uMoonGlowIntensity;
    uniform vec3 uMoonPosition;
    uniform vec3 uMoonColor;

    varying vec3 vWorldPosition;

    void main() {
        float height = normalize(vWorldPosition).y;

        // Multi-stop gradient for Arrakis sky (orange/amber tones)
        vec3 color;
        if (height > 0.3) {
            float t = (height - 0.3) / 0.7;
            color = mix(uMidColor, uTopColor, pow(t, 0.5));
        } else if (height > 0.0) {
            float t = height / 0.3;
            color = mix(uBottomColor, uMidColor, t);
        } else {
            float t = clamp(-height * 2.0, 0.0, 1.0);
            color = mix(uBottomColor, uHorizonColor, t * 0.7);
        }

        // Twin moon glow effect (primary moon)
        vec3 moonDir = normalize(uMoonPosition);
        vec3 viewDir = normalize(vWorldPosition);
        float moonFactor = max(0.0, dot(viewDir, moonDir));
        float moonGlow = pow(moonFactor, 6.0) * 0.5 + pow(moonFactor, 24.0) * 0.4;

        // Secondary moon glow (offset position)
        vec3 moon2Dir = normalize(vec3(100.0, 55.0, -180.0));
        float moon2Factor = max(0.0, dot(viewDir, moon2Dir));
        float moon2Glow = pow(moon2Factor, 8.0) * 0.3 + pow(moon2Factor, 32.0) * 0.2;

        color = mix(color, uMoonColor, (moonGlow + moon2Glow * 0.6) * uMoonGlowIntensity);

        gl_FragColor = vec4(color, 1.0);
    }
`;

// ============== DUNE SHADERS (Shifting Sands - Journey Style) ==============

export const duneVertexShader = `
    uniform float uTime;

    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying float vHeight;
    varying float vSlope;
    varying float vWormTrail; // Pass to fragment for coloring

    void main() {
        vec3 pos = position;
        float wormEffect = 0.0;
        
        // --- CINEMATIC DUNE-STYLE WORM TRAIL ---
        // A single, clear worm path traveling in a consistent direction
        // Like in the movie: a traveling ridge of sand being pushed up
        
        // Worm travels along the Z axis (towards/away from camera)
        // The "worm head" position moves over time
        // The "worm head" position moves over time
        float wormSpeed = 30.0; // Units per second (slower = longer between appearances)
        float wormCycleLength = 2000.0; // Much longer path!
        float wormCycleTime = wormCycleLength / wormSpeed; // Time for one full pass
        float currentCycle = floor(uTime / wormCycleTime); // Which pass we're on (0, 1, 2, ...)
        float wormHeadZ = mod(uTime * wormSpeed, wormCycleLength) - 1000.0; // -1000 to +1000
        
        // The worm path VARIES each cycle!
        // Use the cycle number to generate pseudo-random path parameters
        float cycleHash = fract(sin(currentCycle * 12.9898) * 43758.5453);
        float cycleHash2 = fract(sin(currentCycle * 78.233 + 1.0) * 43758.5453);
        
        // Path equation: x = baseX + slope * z
        // BaseX varies from -100 to +100 each cycle
        float wormPathBaseX = (cycleHash - 0.5) * 200.0;
        // Slope varies from -0.3 to +0.3 each cycle
        float wormPathSlope = (cycleHash2 - 0.5) * 0.6;
        float wormPathX = wormPathBaseX + pos.z * wormPathSlope;
        
        // Distance from the worm's path (perpendicular distance)
        float distFromPath = abs(pos.x - wormPathX);
        
        // Trail width - narrow like a real worm trail
        float trailWidth = 18.0;
        float pathMask = exp(-distFromPath * distFromPath / (trailWidth * trailWidth));
        
        // Distance from the worm's head (along the path)
        float distFromHead = pos.z - wormHeadZ;
        
        // The worm creates a traveling RIDGE
        // - Ahead of the head: sand is flat (not disturbed yet)
        // - At the head: maximum displacement (the worm pushing up)
        // - Behind the head: wake/trail that settles back down
        
        float ridgeLength = 80.0; // Length of the visible ridge
        float wakeLength = 150.0; // Length of the settling wake behind
        
        float ridgeDisplacement = 0.0;
        
        if (distFromHead > 0.0 && distFromHead < ridgeLength) {
            // The main ridge - traveling hump
            float ridgeProgress = distFromHead / ridgeLength;
            // Bell curve shape for the ridge
            ridgeDisplacement = sin(ridgeProgress * 3.14159) * 8.0;
        } else if (distFromHead >= -wakeLength && distFromHead <= 0.0) {
            // The wake behind - settling disturbance
            float wakeProgress = -distFromHead / wakeLength;
            // Smoother wake animation - slower time, lower frequency
            ridgeDisplacement = (1.0 - wakeProgress) * sin(wakeProgress * 4.0 + uTime * 1.5) * 3.0;
        }
        
        pos.y += ridgeDisplacement * pathMask;
        wormEffect = pathMask * (ridgeDisplacement > 0.5 ? 1.0 : 0.3);

        vWormTrail = clamp(wormEffect, 0.0, 1.0);

        vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
        vWorldPosition = worldPosition.xyz;

        vNormal = normalize(normalMatrix * normal);
        vViewPosition = - (modelViewMatrix * vec4(pos, 1.0)).xyz;
        vHeight = pos.y;

        // Calculate slope for wind-facing detection
        vSlope = dot(vNormal, vec3(0.707, 0.0, 0.707));

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;




export const duneFragmentShader = `
    uniform vec3 uColorA; // Deep shadow (cool brown)
    uniform vec3 uColorB; // Golden sand (warm)
    uniform vec3 uColorC; // Wheat highlights
    uniform vec3 uMoonDirection;
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogNear;
    uniform float uFogFar;

    varying vec3 vNormal;
    varying vec3 vViewPosition;
    varying vec3 vWorldPosition;
    varying float vHeight;
    varying float vSlope;
    varying float vWormTrail;

    // Pseudo-random function
    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    // Gradient Noise 3D
    vec3 hash(vec3 p) {
        p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                 dot(p, vec3(269.5, 183.3, 246.1)),
                 dot(p, vec3(113.5, 271.9, 124.6)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float noise(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(dot(hash(i + vec3(0.0, 0.0, 0.0)), f - vec3(0.0, 0.0, 0.0)),
                           dot(hash(i + vec3(1.0, 0.0, 0.0)), f - vec3(1.0, 0.0, 0.0)), u.x),
                       mix(dot(hash(i + vec3(0.0, 1.0, 0.0)), f - vec3(0.0, 1.0, 0.0)),
                           dot(hash(i + vec3(1.0, 1.0, 0.0)), f - vec3(1.0, 1.0, 0.0)), u.x), u.y),
                   mix(mix(dot(hash(i + vec3(0.0, 0.0, 1.0)), f - vec3(0.0, 0.0, 1.0)),
                           dot(hash(i + vec3(1.0, 0.0, 1.0)), f - vec3(1.0, 0.0, 1.0)), u.x),
                       mix(dot(hash(i + vec3(0.0, 1.0, 1.0)), f - vec3(0.0, 1.0, 1.0)),
                           dot(hash(i + vec3(1.0, 1.0, 1.0)), f - vec3(1.0, 1.0, 1.0)), u.x), u.y), u.z);
    }

    void main() {
        vec3 viewDir = normalize(vViewPosition);
        vec3 normal = normalize(vNormal);

        // --- 1. WIND-CARVED RIPPLE NORMAL MAPPING ---
        float rippleScale = 0.4;
        float rippleIntensity = 0.2;
        vec3 ripplePos = vWorldPosition * rippleScale;

        // Directional ripples following wind
        float windAngle = 0.2 * 3.14159;
        vec2 windDir = vec2(cos(windAngle), sin(windAngle));
        float windRipple = noise(vec3(
            dot(vWorldPosition.xz, windDir) * 0.8,
            vWorldPosition.y * 0.1,
            uTime * 0.01
        ));

        float n1 = noise(ripplePos + vec3(0.0, 0.0, uTime * 0.015));
        float n2 = noise(ripplePos * 2.5 + vec3(5.2, 1.3, -uTime * 0.01));

        // Perturb normal based on ripples
        vec3 disturbedNormal = normalize(normal + vec3(n1 + windRipple * 0.5, 0.0, n2) * rippleIntensity);

        // --- 2. DIFFUSE LIGHTING (Arrakis harsh sunlight feel) ---
        float NdotL = dot(disturbedNormal, uMoonDirection);
        float lightIntensity = NdotL * 0.5 + 0.5;

        // Sharper contrast for harsh desert
        lightIntensity = smoothstep(0.2, 0.8, lightIntensity);

        // Mix colors: shadow -> golden -> highlight
        vec3 finalColor = mix(uColorA, uColorB, smoothstep(0.2, 0.5, lightIntensity));
        finalColor = mix(finalColor, uColorC, smoothstep(0.7, 1.0, lightIntensity));

        // --- 3. RIM LIGHTING (Enhanced for dramatic silhouettes) ---
        float NdotV = dot(disturbedNormal, viewDir);
        float rim = 1.0 - max(0.0, NdotV);
        rim = pow(rim, 2.5);
        float rimIntensity = rim * (0.6 + 0.4 * NdotL);
        finalColor += uColorC * rimIntensity * 0.6;

        // --- 4. SPICE GLITTER (Orange sparkles) ---
        vec2 sparkleUV = gl_FragCoord.xy * 0.6;
        float s = random(sparkleUV + floor(vWorldPosition.xz * 80.0) * 0.1);

        float specular = pow(max(0.0, dot(reflect(-uMoonDirection, disturbedNormal), viewDir)), 16.0);
        float sparkleMask = step(0.97, s) * specular * lightIntensity;

        // Orange spice sparkle
        vec3 spiceSparkle = vec3(1.0, 0.6, 0.2);
        finalColor += spiceSparkle * sparkleMask * 3.0;

        // --- 5. HEIGHT-BASED COLOR VARIATION ---
        float heightFactor = smoothstep(-30.0, 20.0, vHeight);
        finalColor = mix(finalColor * 0.85, finalColor, heightFactor);

        // --- 6. FOG & ATMOSPHERIC HAZE ---
        float dist = length(vWorldPosition - cameraPosition);
        float fogFactor = smoothstep(uFogNear, uFogFar, dist);
        finalColor = mix(finalColor, uFogColor, fogFactor);

        // --- 7. WORM TRAIL DUST EFFECT ---
        // Add dust/smoke coloring where worm trails are active
        if (vWormTrail > 0.1) {
            // Dust cloud color (lighter, hazier)
            vec3 dustColor = vec3(0.85, 0.75, 0.55);
            // Add animated noise for dust turbulence
            float dustNoise = noise(vWorldPosition * 0.1 + vec3(uTime * 0.5, 0.0, uTime * 0.3));
            float dustIntensity = vWormTrail * (0.4 + dustNoise * 0.3);
            finalColor = mix(finalColor, dustColor, dustIntensity);
        }

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

// ============== SPICE PARTICLE SHADERS (Improved Swirl) ==============

export const spiceVertexShader = `
    uniform float uTime;
    uniform float uWindStrength;
    uniform float uSpiceIntensity;

    attribute float aPhase;
    attribute float aSize;
    attribute vec3 aColor;

    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    // Curl noise helper for better fluid motion
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) { 
        const vec2  C = vec2(1.0/6.0, 1.0/3.0);
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - i + dot(i, C.xxx);
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
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
    }

    vec3 curlNoise(vec3 p) {
        float e = 0.1;
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
        vColor = aColor;

        vec3 pos = position;
        float t = uTime * 0.15 + aPhase * 10.0;
        
        // Use Curl Noise for beautiful fluid-like swirling
        vec3 seed = pos * 0.03 + vec3(0.0, t * 0.2, 0.0);
        vec3 curl = curlNoise(seed);
        
        // Apply curl influence
        pos += curl * 25.0 * uWindStrength;
        
        // General wind drift
        pos.x += sin(uTime * 0.3) * 10.0;
        pos.z += cos(uTime * 0.2) * 5.0;
        
        // Vertical rise
        pos.y += sin(t * 2.0 + aPhase * 6.28) * 5.0;

        // --- GLOW & ALPHA ---
        // Multi-frequency pulsing for organic glow
        float glow = 0.5 + 0.3 * sin(uTime * 2.5 + aPhase * 6.28);
        glow += 0.2 * sin(uTime * 4.0 + aPhase * 3.14);
        glow *= uSpiceIntensity;
        vGlow = glow;
        vAlpha = glow * 0.85;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float dist = -mvPosition.z;
        gl_PointSize = aSize * glow * uSpiceIntensity * (350.0 / dist);
        gl_PointSize = clamp(gl_PointSize, 1.0, 60.0);

        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const spiceFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    varying float vGlow;

    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;

        // Enhanced sparkly spice look
        float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
        alpha = pow(alpha, 1.2); // Sharper edge for distinct particles
        alpha *= vAlpha;

        // Intense bright core
        float brightness = smoothstep(0.4, 0.0, dist);
        brightness = pow(brightness, 0.5);

        // Color shifts from amber to bright orange-white at center
        vec3 coreColor = vec3(1.0, 0.85, 0.6); // White-gold core
        vec3 color = mix(vColor, coreColor, brightness * vGlow);

        // Overdrive glow
        color *= 1.5;

        gl_FragColor = vec4(color, alpha);
    }
`;

// ============== HEAT SHIMMER POST-PROCESSING SHADER (Refined) ==============

export const heatShimmerShader = `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uStrength;
    uniform vec2 uResolution;

    varying vec2 vUv;

    // Fast noise
    float noise(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
        vec2 uv = vUv;
        float time = uTime * 2.0;

        // High frequency heat waves
        float waveStrength = 0.002 * uStrength * 300.0; // Scaled strength
        
        // Vertical gradient - stronger at bottom
        float heatMask = smoothstep(0.8, 0.2, uv.y);
        
        if (heatMask > 0.01) {
            // Multiple sine waves for complex distortion
            float xOffset = sin(uv.y * 50.0 + time) * 0.001;
            xOffset += sin(uv.y * 20.0 + time * 1.5) * 0.002;
            xOffset *= heatMask * uStrength * 100.0;
            
            float yOffset = cos(uv.x * 40.0 + time) * 0.001 * heatMask * uStrength * 100.0;
            
            uv += vec2(xOffset, yOffset);
        }

        vec4 color = texture2D(tDiffuse, uv);
        
        gl_FragColor = color;
    }
`;

// ============== WORM SHADERS (For animated distant worm) ==============

export const wormVertexShader = `
    uniform float uTime;

    varying vec3 vNormal;
    varying float vSegment;

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vSegment = position.x / 100.0; // Normalized segment position

        vec3 pos = position;

        // Undulating motion
        pos.y += sin(uTime * 2.0 + pos.x * 0.1) * 3.0;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const wormFragmentShader = `
    uniform vec3 uWormColor;
    uniform float uOpacity;

    varying vec3 vNormal;
    varying float vSegment;

    void main() {
        // Simple silhouette shading
        float shade = dot(vNormal, vec3(0.0, 1.0, 0.0)) * 0.3 + 0.7;

        vec3 color = uWormColor * shade;

        gl_FragColor = vec4(color, uOpacity);
    }
`;

// ============== VOLUMETRIC SAND SMOKE SHADERS (Terrain Following + Waves) ==============

export const sandSmokeVertexShader = `
    attribute float size;
    attribute float random;
    varying float vOpacity;
    varying vec2 vUv;
    varying float vRand;
    varying float vZ;
    varying vec3 vWorldPos;
    
    uniform float time;
    uniform float windStrength;

    // --- NOISE FUNCTIONS FOR TERRAIN APPROXIMATION ---
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
            + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
            dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }
    
    // Approximate the dune height logic from CPU
    // We only need the low-frequency "massive dunes" shape for the smoke to follow
    float getApproxTerrainHeight(float x, float z) {
        float dir = 0.628; // Math.PI * 0.2
        float rx = x * cos(dir) + z * sin(dir);
        float rz = -x * sin(dir) + z * cos(dir);
        
        // Match the "massive dunes" scale from theme.js
        // noiseScale.dunes = 0.003
        // heightScale.dunes = 45
        float h = snoise(vec2(rx * 0.003, rz * 0.003));
        h = abs(h * 2.0 - 1.0); // Sharp ridges
        h *= 45.0; // Height scale
        
        return h - 20.0; // Base offset
    }

    void main() {
        vRand = random;
        vec3 pos = position;

        // --- FLOW MOTION: Behind Screen -> Horizon ---
        // Move from +Z to -Z (SLOWED DOWN for visibility)
        float moveSpeed = 15.0 + windStrength * 30.0;  // Reduced from 50/100
        float zOffset = time * moveSpeed;
        
        // Range: -2000 to +800 (2800 units for tighter coverage)
        float range = 4000.0;
        float startZ = 1000.0; // Behind camera
        float currentZ = pos.z - zOffset;
        
        // Wrap logic
        pos.z = startZ - mod(startZ - currentZ, range);

        // --- WORM PATH FOLLOWING (same as dune shader) ---
        // The smoke follows the worm trail!
        
        // Worm path parameters (MUST MATCH duneVertexShader)
        // Worm path parameters (MUST MATCH duneVertexShader)
        float wormSpeed = 30.0;
        float wormCycleLength = 2000.0;
        float wormCycleTime = wormCycleLength / wormSpeed;
        float currentCycle = floor(time / wormCycleTime);
        float wormHeadZ = mod(time * wormSpeed, wormCycleLength) - 1000.0;
        
        // Random path each cycle
        float cycleHash = fract(sin(currentCycle * 12.9898) * 43758.5453);
        float cycleHash2 = fract(sin(currentCycle * 78.233 + 1.0) * 43758.5453);
        float wormPathBaseX = (cycleHash - 0.5) * 200.0;
        float wormPathSlope = (cycleHash2 - 0.5) * 0.6;
        
        // Calculate worm path X at the worm head's Z position
        float wormHeadX = wormPathBaseX + wormHeadZ * wormPathSlope;
        
        // FORCE some particles to BE AT the worm head!
        // Use the random attribute to select which particles are "worm smoke"
        float isWormSmoke = step(0.7, random); // 30% of particles are dedicated worm smoke
        
        if (isWormSmoke > 0.5) {
            // This particle is FORCED to be at the worm head
            // Spread them in a cloud around the worm head
            float spreadX = (fract(random * 17.3) - 0.5) * 60.0;
            // Shift Z forward by +60 to really hit the FRONT (plowing effect)
            float spreadZ = (fract(random * 31.7) - 0.5) * 120.0 + 30.0; 
            
            pos.x = wormHeadX + spreadX;
            pos.z = wormHeadZ + spreadZ;
        }
        
        // Recalculate worm path X at particle's current Z
        float wormPathX = wormPathBaseX + pos.z * wormPathSlope;
        
        // Distance from the worm path
        float distFromPath = abs(pos.x - wormPathX);
        float trailWidth = 50.0; // Wider for smoke cloud
        float pathMask = exp(-distFromPath * distFromPath / (trailWidth * trailWidth));
        
        // Distance from worm head
        float distFromHead = pos.z - wormHeadZ;
        
        // Smoke intensity based on distance from head
        float smokeZone = 0.0;
        // EXTEND trail much further back (-400) and keep forward range (+80)
        if (distFromHead >= -400.0 && distFromHead <= 100.0) {
            if (distFromHead <= 0.0) {
                // Long trail behind
                smokeZone = 1.0 - abs(distFromHead) / 400.0;
                // Add curve to make it denser closer to head
                smokeZone = pow(smokeZone, 0.5);
            } else {
                // Sharp front edge (plowing)
                smokeZone = 1.0 - distFromHead / 100.0;
            }
        }
        
        // Boost for forced worm smoke particles
        if (isWormSmoke > 0.5) {
            smokeZone = max(smokeZone, 0.8);
            pathMask = max(pathMask, 0.9);
        }
        
        // Add turbulence
        pos.x += sin(pos.z * 0.03 + time * 2.0) * 15.0 * smokeZone;


        // --- TERRAIN FOLLOWING ---
        float groundH = getApproxTerrainHeight(pos.x, pos.z);
        
        // Higher smoke near worm, lower elsewhere
        // Lower base to -10.0 so it starts IN the ground and billows up
        // Worm smoke adds less height boost so it stays grounded
        float heightOffset = -10.0 + random * 40.0 + smokeZone * pathMask * 20.0;
        
        // Add "breathing" vertical motion
        float breath = sin(time * 1.5 + random * 100.0) * 10.0;
        
        pos.y = groundH + heightOffset + breath;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        vZ = pos.z;
        vWorldPos = pos * 0.0015; 

        // Size - MUCH bigger near worm path
        float wormVisibility = smokeZone * pathMask;
        float sizeBoost = 1.0 + wormVisibility * 5.0; // 6x size on worm path!
        
        // Robust size calculation with clamping
        float distToCam = max(10.0, -mvPosition.z);
        gl_PointSize = size * sizeBoost * (1000.0 / distToCam);

        // Opacity
        float farFade = smoothstep(-2000.0, -500.0, pos.z);
        
        // Base ambient smoke fades in distance
        float ambientOpacity = farFade * 0.15;
        
        // Worm smoke is ALWAYS visible regardless of distance (no fade)
        float wormOpacity = wormVisibility * 3.0;
        
        vOpacity = ambientOpacity + wormOpacity;
    }
`;

export const sandSmokeFragmentShader = `
    uniform vec3 color;
    uniform float time;
    uniform float windStrength;
    
    varying float vOpacity;
    varying float vZ;
    varying float vRand;
    varying vec3 vWorldPos;

    // --- NOISE FUNCTIONS ---
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
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
    }

    float smoothFbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;
        float frequency = 1.0;
        for (int i = 0; i < 2; i++) { 
            value += amplitude * snoise(p * frequency);
            p.xy *= 1.5; 
            frequency *= 1.8;
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;
        
        float mask = smoothstep(0.5, 0.0, dist);
        mask = pow(mask, 1.5);

        // Slow, smooth time
        float smokeTime = time * (0.1 + windStrength * 0.3);

        vec3 p = vWorldPos + vec3(uv * 1.5, smokeTime * 0.1);
        
        vec3 warp = vec3(
            snoise(p + vec3(0.0, 0.0, smokeTime)),
            snoise(p + vec3(4.3, 1.1, smokeTime * 1.1)),
            0.0
        );
        
        float n = smoothFbm(p + warp * 0.5);
        n = n * 0.5 + 0.5;
        n = smoothstep(0.3, 0.8, n);

        // Bank density
        float bankDensity = snoise(vWorldPos * 1.5 + vec3(0.0, 0.0, time * 0.05));
        bankDensity = smoothstep(-0.3, 0.6, bankDensity);
        
        float density = n * bankDensity;
        
        // INCREASED opacity for better visibility
        float alpha = mask * density * vOpacity * 1.2;  // Bumped from 0.8 to 1.2
        alpha = clamp(alpha, 0.0, 0.9);  // Cap to prevent over-saturation

        vec3 colorVar = color * (0.9 + 0.2 * density);
        
        gl_FragColor = vec4(colorVar, alpha);
    }
`;
