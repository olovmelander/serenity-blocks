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
            // Bell curve shape for the ridge - INCREASED HEIGHT
            ridgeDisplacement = sin(ridgeProgress * 3.14159) * 14.0; // Was 8.0
        } else if (distFromHead >= -wakeLength && distFromHead <= 0.0) {
            // The wake behind - settling disturbance
            float wakeProgress = -distFromHead / wakeLength;
            // Smoother wake animation - slower time, lower frequency
            ridgeDisplacement = (1.0 - wakeProgress) * sin(wakeProgress * 4.0 + uTime * 1.5) * 5.0; // Was 3.0
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

// ============== SPICE PARTICLE SHADERS (OPTIMIZED - Sine-based Swirl) ==============

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

    void main() {
        vColor = aColor;

        vec3 pos = position;
        float t = uTime * 0.15 + aPhase * 10.0;
        
        // OPTIMIZED: Simple sine-based swirling (replaces expensive curl noise)
        float swirl1 = sin(t * 1.2 + pos.y * 0.05) * 20.0 * uWindStrength;
        float swirl2 = cos(t * 0.9 + pos.x * 0.03) * 15.0 * uWindStrength;
        float swirl3 = sin(t * 0.7 + pos.z * 0.04) * 10.0 * uWindStrength;
        
        pos.x += swirl1;
        pos.z += swirl2;
        pos.y += swirl3;
        
        // General wind drift
        pos.x += sin(uTime * 0.3) * 10.0;
        pos.z += cos(uTime * 0.2) * 5.0;
        
        // Vertical rise
        pos.y += sin(t * 2.0 + aPhase * 6.28) * 5.0;

        // --- GLOW & ALPHA ---
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

// ============== SAND SMOKE SHADERS (PREMIUM DUNE-STYLE) ==============
// Advanced: Smooth FBM, billowing turbulence, worm trail emphasis, atmospheric depth

export const sandSmokeVertexShader = `
    attribute float size;
    attribute float random;
    
    varying float vOpacity;
    varying float vRand;
    varying float vWormIntensity;
    varying float vDepth;
    varying vec2 vWorldXZ;
    
    uniform float time;
    uniform float windStrength;

    // Smooth interpolated hash noise (no grid artifacts)
    float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    
    float smoothNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f); // Smoothstep interpolation
        
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    // Simple FBM for terrain (2 octaves, optimized)
    float fbm(vec2 p) {
        float v = 0.0;
        v += smoothNoise(p) * 0.6;
        v += smoothNoise(p * 2.0) * 0.4;
        return v;
    }
    
    float getApproxTerrainHeight(float x, float z) {
        float dir = 0.628;
        float rx = x * cos(dir) + z * sin(dir);
        float rz = -x * sin(dir) + z * cos(dir);
        float h = fbm(vec2(rx * 0.003, rz * 0.003));
        h = abs(h * 2.0 - 1.0);
        return h * 45.0 - 20.0;
    }

    void main() {
        vRand = random;
        vec3 pos = position;

        // --- FLOW MOTION ---
        float moveSpeed = 12.0 + windStrength * 25.0;
        float zOffset = time * moveSpeed;
        float range = 4000.0;
        float startZ = 1000.0;
        pos.z = startZ - mod(startZ - (pos.z - zOffset), range);

        // --- WORM PATH FOLLOWING ---
        float wormSpeed = 30.0;
        float wormCycleLength = 2000.0;
        float wormCycleTime = wormCycleLength / wormSpeed;
        float currentCycle = floor(time / wormCycleTime);
        float wormHeadZ = mod(time * wormSpeed, wormCycleLength) - 1000.0;
        
        // HORIZON FADE-IN: Prevent pop-in when resetting to -1000.0
        float distFromStart = wormHeadZ - (-1000.0);
        // Fade in extremely slowly over first 1200 units
        float horizonFade = smoothstep(0.0, 1200.0, distFromStart);
        horizonFade = pow(horizonFade, 5.0); // Power 5.0 for extremely subtle start 

        
        float cycleHash = hash(vec2(currentCycle, 0.0));
        float cycleHash2 = hash(vec2(currentCycle, 1.0));
        float wormPathBaseX = (cycleHash - 0.5) * 200.0;
        float wormPathSlope = (cycleHash2 - 0.5) * 0.6;
        float wormHeadX = wormPathBaseX + wormHeadZ * wormPathSlope;
        
        // 30% of particles are worm-attracted (optimized for performance)
        float isWormSmoke = step(0.7, random);
        
        if (isWormSmoke > 0.5) {
            // Particles attracted strongly to worm head with turbulent spread
            float spreadX = (hash(vec2(random, 17.3)) - 0.5) * 80.0;
            float spreadZ = (hash(vec2(random, 31.7)) - 0.5) * 150.0 + 50.0;
            
            // Add billowing turbulence
            float turb = sin(time * 3.0 + random * 100.0) * 15.0;
            spreadX += turb;
            
            pos.x = wormHeadX + spreadX;
            pos.z = wormHeadZ + spreadZ;
        }
        
        float wormPathX = wormPathBaseX + pos.z * wormPathSlope;
        float distFromPath = abs(pos.x - wormPathX);
        float trailWidth = 60.0;
        float pathMask = exp(-distFromPath * distFromPath / (trailWidth * trailWidth));
        float distFromHead = pos.z - wormHeadZ;
        
        // Smoke zone - extended trail
        float smokeZone = 0.0;
        if (distFromHead >= -500.0 && distFromHead <= 120.0) {
            if (distFromHead <= 0.0) {
                smokeZone = 1.0 - abs(distFromHead) / 500.0;
                smokeZone = pow(smokeZone, 0.4); // Denser near head
            } else {
                smokeZone = 1.0 - distFromHead / 120.0;
                smokeZone = pow(smokeZone, 0.5); // Sharp front
            }
        }
        
        // Strong boost for worm particles
        if (isWormSmoke > 0.5) {
            smokeZone = max(smokeZone, 0.9);
            pathMask = max(pathMask, 0.95);
        }
        
        float wormVisibility = smokeZone * pathMask;
        wormVisibility *= horizonFade; // Apply smooth entrance
        vWormIntensity = wormVisibility;
        
        // Billowing turbulence on worm trail (only for worm particles)
        if (wormVisibility > 0.1) {
            float billow = sin(pos.z * 0.02 + time * 2.5) * cos(pos.x * 0.03 + time * 1.8);
            pos.x += billow * 20.0 * wormVisibility;
        }

        // --- TERRAIN FOLLOWING (optimized) ---
        // Simplified height for ambient particles, full calc for worm trail
        float groundH = wormVisibility > 0.2 ? getApproxTerrainHeight(pos.x, pos.z) : -15.0;

        // Worm smoke rises higher and billows more
        float baseHeight = -5.0 + random * 25.0;
        float wormLift = wormVisibility * 35.0;
        float breath = sin(time * 2.0 + random * 80.0) * 8.0 * (1.0 + wormVisibility);
        pos.y = groundH + baseHeight + wormLift + breath;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        
        vWorldXZ = pos.xz * 0.01;
        vDepth = -mvPosition.z;

        // Size: Optimized for performance - larger base particles, smaller boost
        float sizeBoost = 1.0 + wormVisibility * 3.5; // Further reduced for performance
        float distToCam = max(10.0, vDepth);
        gl_PointSize = size * sizeBoost * (500.0 / distToCam); // Balanced with larger base sizes

        // Opacity: Nearly invisible ambient, subtle worm trail
        float farFade = smoothstep(-2500.0, -400.0, pos.z);
        float ambientOpacity = farFade * 0.02; // Nearly invisible (was 0.05)
        float wormOpacity = wormVisibility * 1.5; // Reduced from 3.0
        vOpacity = ambientOpacity + wormOpacity;
    }
`;

export const sandSmokeFragmentShader = `
    uniform vec3 color;
    uniform float time;
    
    varying float vOpacity;
    varying float vRand;
    varying float vWormIntensity;
    varying float vDepth;
    varying vec2 vWorldXZ;

    // Smooth interpolated noise
    float hash(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
    }
    
    float smoothNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    
    // Smooth FBM for billowing texture (2 octaves - optimized)
    float fbm(vec2 p) {
        float v = 0.0;
        v += 0.5 * smoothNoise(p);
        v += 0.25 * smoothNoise(p * 2.2);
        return v;
    }

    void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float dist = length(uv);
        if (dist > 0.5) discard;
        
        // Very soft gaussian core
        float coreMask = exp(-dist * dist * 5.0);
        
        // Animated billowing noise coordinates
        float smokeTime = time * 0.35;
        vec2 noiseCoord = uv * 5.0 + vWorldXZ + vec2(smokeTime * 0.25, smokeTime * 0.15);
        noiseCoord += vec2(vRand * 6.0);
        
        // Turbulent billowing effect - optimized for performance
        float turbulence = smoothNoise(noiseCoord);
        float billow = fbm(noiseCoord * 1.8 + vec2(turbulence * 0.6, -smokeTime * 0.15));

        // Simplified wispy edge erosion
        float edgeNoise = smoothNoise(uv * 6.0 + vec2(vRand * 15.0, smokeTime * 0.8));
        float wispyEdge = smoothstep(0.25 + edgeNoise * 0.2, 0.48, dist);

        // Combine for final smoke shape - more wispy and transparent
        float density = coreMask * (0.3 + billow * 0.5);
        density *= (1.0 - wispyEdge * 0.9);
        
        // Worm trail smoke is only slightly denser
        density = mix(density * 0.25, density * 0.5, vWormIntensity);
        
        // VERY TRANSPARENT - barely visible
        float alpha = density * vOpacity * 0.25;
        alpha = clamp(alpha, 0.0, 0.2); // Max 20% opacity

        // --- DYNAMIC GOLDEN PARTICLES (flow with smoke) ---
        // Sparkles tied to the turbulence flow, not screen space
        vec2 flowCoord = noiseCoord * 2.0 + vec2(turbulence, billow) * 3.0;
        float sparkle = smoothNoise(flowCoord * 8.0);
        
        // Threshold creates scattered sparkles that move with the flow
        float sparkleThreshold = smoothstep(0.85, 0.95, sparkle);
        
        // Intensity modulated by smoke density - brighter in denser areas
        float sparkleIntensity = sparkleThreshold * density * 0.6;
        
        // Subtle warm gold that blends with smoke
        vec3 sparkleColor = vec3(1.0, 0.92, 0.7) * 1.5;

        // Realistic Arrakis sand dust colors with volumetric depth
        vec3 sandDust = color;
        
        // Volumetric light scattering - brighter core, darker edges
        vec3 litCore = sandDust * vec3(1.25, 1.15, 1.0); // Warm lit center
        vec3 shadowEdge = sandDust * vec3(0.7, 0.65, 0.6); // Cool shadow
        float lightScatter = pow(1.0 - dist, 2.0) * billow;
        sandDust = mix(shadowEdge, litCore, lightScatter);
        
        // Depth-based atmospheric fade
        float depthFade = smoothstep(50.0, 800.0, vDepth);
        vec3 hazeColor = vec3(0.75, 0.65, 0.5);
        sandDust = mix(sandDust, hazeColor, depthFade * 0.6);
        
        // Subtle variation from turbulence
        sandDust *= (0.9 + billow * 0.2);
        
        // Add flowing golden particles
        sandDust += sparkleColor * sparkleIntensity;
        
        // Sparkles boost alpha slightly
        alpha += sparkleIntensity * 0.15;
        alpha = clamp(alpha, 0.0, 0.3);
        
        gl_FragColor = vec4(sandDust, alpha);
    }
`;
