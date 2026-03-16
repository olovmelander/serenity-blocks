/**
 * Wolfhour Theme Shaders
 */

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader
// ─────────────────────────────────────────────────────────────────────────────
export const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.0 },
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
        uniform float darkness;
        uniform float offset;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec2 uv = (vUv - 0.5) * 2.0;
            float dist = length(uv);
            float vig = smoothstep(offset, offset - 0.5, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

export const SilverTintShader = {
    uniforms: {
        tDiffuse: { value: null },
        uAmount: { value: 0.3 },
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
        uniform float uAmount;
        varying vec2 vUv;

        void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            float gray = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
            vec3 silver = vec3(gray) * vec3(1.1, 1.1, 1.2); // Blue-ish tint
            
            // Mix original with silver
            texel.rgb = mix(texel.rgb, silver, uAmount);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Mountain Shaders
// ─────────────────────────────────────────────────────────────────────────────
export const mountainVertexShader = `
    attribute float aHeight;
    attribute float aBaseMask;

    uniform float uTime;
    uniform float uShockwave; // New: For piece lock displacement

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vHeight;
    varying float vBaseMask;
    varying vec2 vUv;

    void main() {
        vNormal = normalize(normalMatrix * normal);
        vUv = uv;
        vHeight = aHeight;
        vBaseMask = aBaseMask;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPos.xyz;

        // Shockwave displacement
        if (uShockwave > 0.0) {
            float dist = length(worldPos.xz); // Distance from center
            float wave = sin(dist * 0.05 - uTime * 10.0) * uShockwave * 20.0;
            // Only affect top of mountains
            worldPos.y += wave * smoothstep(0.0, 100.0, worldPos.y); 
        }

        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

export const mountainFragmentShader = `
    uniform vec3 uRockColorDark;
    uniform vec3 uRockColorMid;
    uniform vec3 uRockColorLight;
    uniform float uMountainLayer;
    uniform float uPulseIntensity;
    uniform float uTime;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;
    varying float vHeight;
    varying float vBaseMask;
    varying vec2 vUv;

    // FBM noise for rock texture
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
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
            v += a * noise(p);
            p *= 2.0;
            a *= 0.5;
        }
        return v;
    }

    void main() {
        float skirtFade = smoothstep(0.18, 1.0, vBaseMask);

        // Base rock color based on layer (closer = darker)
        vec3 rockColor = mix(uRockColorDark, uRockColorLight, uMountainLayer);

        // Subtle rock texture variation
        float rockNoise = fbm(vWorldPosition.xz * 0.02);
        rockColor *= 0.9 + rockNoise * 0.2;

        // Simple lighting
        vec3 lightDir = normalize(vec3(0.3, 0.8, 0.5));
        float diff = max(0.4, dot(vNormal, lightDir));
        vec3 color = rockColor * diff;

        // Rim lighting for silhouette definition
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
        color += vec3(0.1, 0.1, 0.12) * rim * (1.0 - skirtFade * 0.92);

        // Gameplay pulse effect (silver glow on peaks)
        float peakGlow = smoothstep(0.6, 1.0, vHeight) * uPulseIntensity * (1.0 - skirtFade);
        color += vec3(0.8, 0.8, 0.9) * peakGlow * 0.3;

        // Darken the outer skirt into a stable silhouette mass so zoom-out doesn't show glossy stretch.
        vec3 baseShadow = mix(rockColor * 0.4, vec3(0.02, 0.022, 0.03), skirtFade);
        color = mix(color, baseShadow, skirtFade);

        // === ATMOSPHERIC FOG ===
        // Distant mountains fade toward a darker misty color (keeping them dark)
        vec3 fogColor = vec3(0.12, 0.13, 0.16); // Much darker fog
        float atmosphericFade = pow(uMountainLayer, 1.8) * 0.35; // Reduced fade, more gradual
        color = mix(color, fogColor, atmosphericFade);

        gl_FragColor = vec4(color, 1.0);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Starfield Shaders
// ─────────────────────────────────────────────────────────────────────────────
export const starfieldVertexShader = `
    attribute float aSize;
    attribute vec2 aTwinkle;
    attribute float aBrightness;


    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uEventBoost;

    varying vec3 vColor;
    varying float vBrightness;

    void main() {
        vColor = color;

        // Twinkle animation
        float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
        vBrightness = aBrightness * (0.7 + twinkle * 0.3);
        vBrightness *= (1.0 + uEventBoost * 0.5);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Size attenuation
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);

        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const starfieldFragmentShader = `
    varying vec3 vColor;
    varying float vBrightness;

    void main() {
        // Soft circular point with glow
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;

        // Soft circular falloff
        float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);

        // Core brightness
        vec3 coreColor = vColor * vBrightness * 1.5;
        float alpha = softCircle * (vBrightness + 0.2);

        gl_FragColor = vec4(coreColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Spirit Shaders
// ─────────────────────────────────────────────────────────────────────────────
export const spiritVertexShader = `
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aSize;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uSurgeIntensity;

    varying float vAlpha;

    void main() {
        // Floating sine wave animation
        vec3 pos = position;
        float t = uTime * aSpeed + aPhase;
        pos.y += sin(t) * 20.0;
        pos.x += cos(t * 0.7) * 15.0;

        // Fade based on height and time
        float heightFade = smoothstep(50.0, 200.0, pos.y);
        float pulseFade = 0.3 + sin(t * 2.0) * 0.2;
        vAlpha = heightFade * pulseFade * (1.0 + uSurgeIntensity * 0.5);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * (1.0 + uSurgeIntensity * 0.3);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const spiritFragmentShader = `
    varying float vAlpha;

    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;

        // Soft ethereal glow
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.5);

        // Silver/white color
        vec3 color = vec3(0.9, 0.9, 1.0);

        gl_FragColor = vec4(color, glow * vAlpha * 0.6);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Effect Shaders (Burst, Beam, Rift)
// ─────────────────────────────────────────────────────────────────────────────
export const burstVertexShader = `
    attribute vec3 aVelocity;
    attribute float aSize;
    uniform float uTime;
    uniform float uPixelRatio;
    varying float vAlpha;

    void main() {
        vec3 pos = position + aVelocity * uTime;
        // Gravity effect
        pos.y -= 50.0 * uTime * uTime;

        vAlpha = 1.0 - uTime * 1.5;
        vAlpha = max(0.0, vAlpha);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * vAlpha;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const burstFragmentShader = `
    varying float vAlpha;

    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);

        vec3 color = vec3(0.9, 0.9, 1.0); // Silver/white
        gl_FragColor = vec4(color, glow * vAlpha);
    }
`;

export const beamVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const beamFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
        // Use distance from vertical center line for beam shape
        float distFromCenterX = abs(vUv.x - 0.5) * 2.0;
        float distFromCenterY = abs(vUv.y - 0.5) * 2.0;
        
        // Horizontal beam shape - gaussian falloff
        float beamShape = exp(-distFromCenterX * distFromCenterX * 20.0);
        
        // Vertical fade - visible in center, faded at top/bottom
        float vertFade = 1.0 - smoothstep(0.1, 0.5, distFromCenterY);
        float edgeFade = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        
        float shimmer = sin(vUv.y * 50.0 + uTime * 10.0) * 0.08 + 0.92;
        float alpha = beamShape * vertFade * edgeFade * uOpacity * shimmer;
        
        vec3 color = vec3(0.9, 0.9, 1.0);
        gl_FragColor = vec4(color, alpha * 0.5);
    }
`;

export const riftVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const riftFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
        // Horizontal gradient - heavily tapered ends
        float edgeFade = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);

        // Core glow - softer
        float centerFade = 1.0 - abs(vUv.y - 0.5) * 2.0;
        centerFade = pow(centerFade, 2.0);

        // Electric crackle effect (reduced)
        float crackle = sin(vUv.x * 30.0 + uTime * 15.0) * 0.2 + 0.8;

        float alpha = edgeFade * centerFade * uOpacity * crackle;
        alpha = pow(alpha, 1.4); // Extra soft edges

        // Bright silver core
        vec3 color = vec3(0.95, 0.95, 1.0);

        gl_FragColor = vec4(color, alpha * 0.5); // Reduced intensity
    }
`;

export const nebulaVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const nebulaFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform float uOpacity;
    uniform float uPulse;
    varying vec2 vUv;

    void main() {
        vec4 texColor = texture2D(tDiffuse, vUv);

        // Extremely aggressive edge fade - only center is fully visible
        float fadeX = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
        float fadeY = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
        float fade = fadeX * fadeY;
        fade = pow(fade, 2.0); // Very smooth center-focused falloff

        // Pulse effect (gameplay) - minimal to avoid revealing edges
        float alpha = texColor.a * (uOpacity + uPulse * 0.05) * fade;
        vec3 color = texColor.rgb * (1.0 + uPulse * 0.3);

        gl_FragColor = vec4(color, alpha);
    }
`;

export const waveVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const waveFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    varying vec2 vUv;

    void main() {
        // Edge fade - must be zero at geometry boundaries
        float edgeFadeX = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
        float edgeFadeY = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        float edgeFade = edgeFadeX * edgeFadeY;
        
        // Horizontal ripple moving L to R
        float dist = abs(vUv.x - 0.5 - uTime * 0.5);
        float ripple = sin(dist * 20.0 - uTime * 10.0) * 0.5 + 0.5;
        float alpha = uOpacity * smoothstep(0.5, 0.0, dist) * ripple * edgeFade;
        
        vec3 color = vec3(0.8, 0.85, 1.0);
        gl_FragColor = vec4(color, alpha * 0.4);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Fog Shaders (Misty layer at mountain base)
// ─────────────────────────────────────────────────────────────────────────────

export const fogVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const fogFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uPulse;
    uniform float uSwirl;
    varying vec2 vUv;
    
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
        return v;
    }
    void main() {
        vec2 centered = vUv - 0.5;
        vec2 driftUv = vec2(
            vUv.x * 3.2 + uTime * 0.032 + centered.y * 0.25,
            vUv.y * 2.6 + uTime * 0.018
        );
        vec2 swirlUv = vec2(
            vUv.x * 5.1 - uTime * 0.025,
            vUv.y * 3.7 + uTime * 0.021
        );
        float densityA = fbm(driftUv);
        float densityB = fbm(swirlUv);
        float density = mix(densityA, densityB, clamp(uSwirl, 0.0, 1.0));
        float verticalFade = 1.0 - smoothstep(0.15, 1.0, vUv.y);
        float edgeFade = smoothstep(0.02, 0.22, vUv.x) * (1.0 - smoothstep(0.78, 0.98, vUv.x));
        float fogAlpha = density * verticalFade * edgeFade * uOpacity * (0.8 + uPulse * 0.35) * 0.75;
        vec3 fogColor = mix(vec3(0.14, 0.15, 0.18), vec3(0.2, 0.22, 0.28), density);
        gl_FragColor = vec4(fogColor, fogAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shooting Star Shaders
// ─────────────────────────────────────────────────────────────────────────────

export const shootingStarVertexShader = `
    attribute float aProgress;
    attribute float aSize;
    uniform float uPixelRatio;
    varying float vProgress;
    varying float vAlpha;
    void main() {
        vProgress = aProgress;
        vAlpha = smoothstep(0.0, 0.3, aProgress) * smoothstep(1.0, 0.7, aProgress);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (1.0 - aProgress * 0.8) * uPixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const shootingStarFragmentShader = `
    varying float vProgress;
    varying float vAlpha;
    void main() {
        float dist = length(gl_PointCoord - 0.5) * 2.0;
        if (dist > 1.0) discard;
        gl_FragColor = vec4(mix(vec3(1.0), vec3(0.7, 0.8, 1.0), vProgress), (1.0 - dist * dist) * vAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Impressive Meteor Trail Shader (for LINE_STRIP with fade)
// ─────────────────────────────────────────────────────────────────────────────

export const meteorTrailVertexShader = `
    attribute float aTrailPosition; // 0.0 = head, 1.0 = tail end
    
    uniform float uTime;
    uniform float uProgress; // 0.0 = start, 1.0 = end of meteor lifetime
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    
    void main() {
        vTrailPos = aTrailPosition;
        
        // Fade in at start, fade out at end
        float fadeIn = smoothstep(0.0, 0.15, uProgress);
        float fadeOut = smoothstep(1.0, 0.7, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const meteorTrailFragmentShader = `
    uniform float uTime;
    uniform float uProgress;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    
    void main() {
        // Trail fades from bright head to dim tail
        float trailFade = pow(1.0 - vTrailPos, 2.5); // Brighter at head (pos=0)
        
        // Subtle shimmer
        float shimmer = 0.95 + 0.05 * sin(vTrailPos * 30.0 + uTime * 10.0);
        
        // Color: white-silver head transitioning to cooler blue tail
        vec3 headColor = vec3(1.0, 1.0, 1.0);
        vec3 tailColor = vec3(0.6, 0.7, 0.9);
        vec3 color = mix(headColor, tailColor, vTrailPos);
        
        // Final alpha includes trail fade and life fade
        float alpha = trailFade * vLifeAlpha * shimmer;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Meteor Glow Head Shader (bright sphere at meteor front)
// ─────────────────────────────────────────────────────────────────────────────

export const meteorHeadVertexShader = `
    uniform float uProgress;
    uniform float uPixelRatio;
    
    varying float vLifeAlpha;
    
    void main() {
        // Fade in and out
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.6, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 12.0 * uPixelRatio;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const meteorHeadFragmentShader = `
    varying float vLifeAlpha;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5) * 2.0;
        if (dist > 1.0) discard;
        
        // Glowing core with soft falloff
        float glow = 1.0 - dist;
        glow = pow(glow, 1.5);
        
        // Bright white core with silver halo
        vec3 core = vec3(1.0, 1.0, 1.0);
        vec3 halo = vec3(0.9, 0.92, 1.0);
        vec3 color = mix(halo, core, glow);
        
        gl_FragColor = vec4(color, glow * vLifeAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Meteor Crash Effect Shaders
// ─────────────────────────────────────────────────────────────────────────────

// Impact Flash - bright flash at impact point
export const impactFlashVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const impactFlashFragmentShader = `
    uniform float uProgress;
    uniform vec2 uCenter;
    varying vec2 vUv;
    
    void main() {
        // Distance from impact center (normalized screen coords)
        vec2 pos = vUv - uCenter;
        float dist = length(pos);
        
        // Flash expands outward quickly then fades
        float flashRadius = uProgress * 0.8;
        float flash = smoothstep(flashRadius + 0.1, flashRadius, dist);
        flash *= 1.0 - uProgress; // Fade out over time
        flash = pow(flash, 0.5); // Brighter core
        
        // Color: bright white with silver edge
        vec3 color = mix(vec3(0.9, 0.92, 1.0), vec3(1.0), flash);
        
        gl_FragColor = vec4(color, flash * 0.8);
    }
`;

// Debris Particles - rock fragments with gravity
export const debrisVertexShader = `
    attribute vec3 aVelocity;
    attribute float aSize;
    attribute float aRotation;
    
    uniform float uTime;
    uniform float uPixelRatio;
    
    varying float vAlpha;
    varying float vTwinkle;
    
    void main() {
        // Apply velocity and gravity (reduced gravity for floatier sparks)
        vec3 pos = position;
        pos += aVelocity * uTime;
        pos.y -= 200.0 * uTime * uTime; // Lighter gravity
        
        // Fade out significantly slower (over 4.5 seconds)
        float life = 1.0 - smoothstep(0.0, 4.5, uTime);
        vAlpha = life; // Fully opaque initially, then fades
        
        // Twinkle effect
        vTwinkle = 0.7 + 0.3 * sin(uTime * 8.0 + aRotation * 10.0);
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * vAlpha * vTwinkle;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const debrisFragmentShader = `
    varying float vAlpha;
    varying float vTwinkle;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        // Soft circular glow
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.5);
        
        // Silver/white spark colors with slight blue tint
        vec3 core = vec3(1.0, 1.0, 1.0);
        vec3 halo = vec3(0.85, 0.88, 1.0);
        vec3 color = mix(halo, core, glow);
        
        gl_FragColor = vec4(color, glow * vAlpha * vTwinkle);
    }
`;

// Shockwave Ring - expanding ring of light
export const shockwaveVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const shockwaveFragmentShader = `
    uniform float uProgress;
    uniform float uOpacity;
    
    varying vec2 vUv;
    
    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center) * 2.0;
        
        // Ring expands from center
        float ringRadius = uProgress * 1.2;
        float ringWidth = 0.15 * (1.0 - uProgress * 0.5); // Ring thins as it expands
        
        // Ring shape with soft edges
        float ring = smoothstep(ringRadius - ringWidth, ringRadius - ringWidth * 0.5, dist)
                   * smoothstep(ringRadius + ringWidth * 0.5, ringRadius, dist);
        
        // Fade out as it expands
        float fade = (1.0 - uProgress) * uOpacity;
        
        // Silver-white color with slight blue tint
        vec3 color = vec3(0.9, 0.92, 1.0);
        
        gl_FragColor = vec4(color, ring * fade);
    }
`;

// Dust Cloud - soft billowing particles
export const dustCloudVertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aVelocity;
    
    uniform float uTime;
    uniform float uPixelRatio;
    
    varying float vAlpha;
    
    void main() {
        vec3 pos = position;
        
        // Billowing motion - rises and spreads
        float t = uTime;
        pos += aVelocity * t;
        pos.y += sin(t * 2.0 + aPhase) * 20.0; // Turbulence
        pos.x += cos(t * 1.5 + aPhase) * 15.0;
        
        // Slow rise
        pos.y += t * 30.0;
        
        // Fade in quickly, then fade out slowly (over 4.5 seconds)
        float fadeIn = smoothstep(0.0, 0.2, uTime);
        float fadeOut = smoothstep(4.5, 1.0, uTime); // Note: smoothstep(edge0, edge1, x) returns 0 if x >= edge1? No, 1 IF edge0 < edge1. Here edge0 > edge1 is likely wrong usage or "standard" fading logic often does 1.0 - smoothstep. 
        // Actually, smoothstep(2.5, 1.0, uTime) is undefined behavior or at least weird if min > max in some GLSL versions, but often used as 1.0 - smoothstep.
        // Let's use standard: float life = 1.0 - smoothstep(0.0, 4.5, uTime);
        // But here 'fadeOut' variable suggests it's a multiplier.
        // Existing was: float fadeOut = smoothstep(2.5, 1.0, uTime); 
        // Wait, if 2.5 > 1.0, smoothstep results might be inverted or clamped? 
        // Standard textual replacement suggested:
        
        float life = 1.0 - smoothstep(1.0, 4.5, uTime); // Fade out from 1s to 4.5s
        vAlpha = fadeIn * life * 0.4;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Particles grow as dust expands
        float grow = 1.0 + uTime * 0.5;
        gl_PointSize = aSize * uPixelRatio * grow;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const dustCloudFragmentShader = `
    varying float vAlpha;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        // Very soft circular falloff
        float soft = 1.0 - smoothstep(0.0, 1.0, dist);
        soft = pow(soft, 0.8);
        
        // Gray-brown dust color
        vec3 color = vec3(0.4, 0.38, 0.35);
        
        gl_FragColor = vec4(color, soft * vAlpha);
    }
`;

// Impact Meteor Head - larger, more intense glow for crash meteor
export const crashMeteorHeadVertexShader = `
    uniform float uProgress;
    uniform float uPixelRatio;
    
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        // Fade in fast, stay bright until impact
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.9, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        // Intensity increases as meteor approaches impact
        vIntensity = 1.0 + uProgress * 0.5;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        // Larger than regular meteor head
        gl_PointSize = 20.0 * uPixelRatio * vIntensity;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const crashMeteorHeadFragmentShader = `
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5) * 2.0;
        if (dist > 1.0) discard;
        
        // Intense glowing core
        float glow = 1.0 - dist;
        glow = pow(glow, 1.2);
        
        // Bright core with fiery halo
        vec3 core = vec3(1.0, 1.0, 1.0);
        vec3 halo = vec3(1.0, 0.9, 0.7); // Warmer/fiery tint
        vec3 color = mix(halo, core, glow) * vIntensity;
        
        gl_FragColor = vec4(color, glow * vLifeAlpha);
    }
`;

// Crash Meteor Trail - more intense, thicker trail
export const crashMeteorTrailVertexShader = `
    attribute float aTrailPosition;
    
    uniform float uTime;
    uniform float uProgress;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        vTrailPos = aTrailPosition;
        
        // Stays visible until impact
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.85, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        // Intensity ramps up as meteor descends
        vIntensity = 1.0 + uProgress * 0.3;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const crashMeteorTrailFragmentShader = `
    uniform float uTime;
    uniform float uProgress;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        // Trail fades from bright head to dim tail
        float trailFade = pow(1.0 - vTrailPos, 2.0);
        
        // More aggressive shimmer
        float shimmer = 0.9 + 0.1 * sin(vTrailPos * 40.0 + uTime * 15.0);
        
        // Color: white-orange head transitioning to silver-blue tail
        vec3 headColor = vec3(1.0, 0.95, 0.85);
        vec3 tailColor = vec3(0.7, 0.75, 0.9);
        vec3 color = mix(headColor, tailColor, vTrailPos) * vIntensity;
        
        float alpha = trailFade * vLifeAlpha * shimmer;
        
        gl_FragColor = vec4(color, alpha);
    }
`;
