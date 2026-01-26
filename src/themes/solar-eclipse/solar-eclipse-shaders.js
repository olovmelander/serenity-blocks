/**
 * Solar Eclipse Theme Shaders
 *
 * Premium shader effects for the most impressive theme experience.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Star Shaders - Twinkling with eclipse-warm colors
// ─────────────────────────────────────────────────────────────────────────────

export const starVertexShader = `
    attribute float aSize;
    attribute vec2 aTwinkle; // x = phase offset, y = speed multiplier
    attribute float aBrightness;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uEventBoost;

    varying float vBrightness;
    varying vec3 vColor;

    void main() {
        vColor = color;
        
        // Twinkle animation with varied speed per star
        float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
        vBrightness = aBrightness * (0.7 + twinkle * 0.3);
        vBrightness *= (1.0 + uEventBoost * 0.5);
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Size attenuation for depth - larger for atmospheric look
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 3.0, 80.0);
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const starFragmentShader = `
    varying float vBrightness;
    varying vec3 vColor;

    void main() {
        // Soft circular point with atmospheric glow
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        // Discard outside circle for round shape
        if (dist > 1.0) discard;
        
        // Soft atmospheric falloff - smooth gradient from center
        float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
        softCircle = pow(softCircle, 0.8); // Slightly wider glow
        
        // Bright core with halo
        float core = 1.0 - smoothstep(0.0, 0.25, dist);
        
        // Color with boosted core brightness
        vec3 coreColor = vColor * vBrightness * 1.5 + vec3(0.15) * core;
        
        // Atmospheric alpha with minimum visibility
        float alpha = softCircle * (vBrightness + 0.2);
        
        gl_FragColor = vec4(coreColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Eclipse Spark Burst Shaders - Dramatic combo effect particles
// ─────────────────────────────────────────────────────────────────────────────

export const eclipseSparkVertexShader = `
    attribute float aTheta;
    attribute float aPhi;
    attribute float aRadius;
    attribute float aRandom;
    attribute vec3 aColor;

    uniform float time;
    uniform float uPulseTimer;
    uniform vec3 uMoonPosition;
    uniform float uMoonRadius;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vColor = aColor;
        
        // Particles burst outward from sun surface
        float effectiveRadius = aRadius;
        float lifeTime = 0.0;
        
        if (uPulseTimer > -50.0) {
            // Calculate individual particle timing with stagger
            float stagger = aRandom * 5.0;
            float t = max(0.0, uPulseTimer - stagger);
            
            // Velocity increases then decelerates (Longer fly time)
            float velocity = 15.0 + aRandom * 8.0;
            float deceleration = 0.005;
            float travel = velocity * t - 0.5 * deceleration * t * t;
            
            effectiveRadius = aRadius + max(0.0, travel);
            
            // Lifetime for fading (Longer duration)
            float maxLife = 100.0 + aRandom * 40.0;
            lifeTime = clamp(t / maxLife, 0.0, 1.0);
            
            // Fade in quickly, fade out gradually
            float fadeIn = smoothstep(0.0, 0.1, lifeTime);
            float fadeOut = 1.0 - smoothstep(0.4, 1.0, lifeTime);
            vAlpha = fadeIn * fadeOut;
        } else {
            vAlpha = 0.0;
        }
        
        // Spherical coordinates to 3D position
        vec3 pos;
        pos.x = effectiveRadius * sin(aPhi) * cos(aTheta);
        pos.y = effectiveRadius * sin(aPhi) * sin(aTheta);
        pos.z = effectiveRadius * cos(aPhi) - 100.0; // Offset to sun center
        
        // Occlusion Logic: Mask particles that are visually "inside" the Moon disk
        // This prevents them from flying "through" the black moon from behind
        float distToMoonCenter = distance(pos.xy, uMoonPosition.xy);
        if (distToMoonCenter < uMoonRadius) {
            vAlpha = 0.0;
        }
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Size decreases as particles travel outward
        float sizeFade = 1.0 - lifeTime * 0.6;
        gl_PointSize = (6.0 + aRandom * 8.0) * sizeFade;
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const eclipseSparkFragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        if (vAlpha < 0.01) discard;
        
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        // Soft glowing particle
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.5);
        
        // Hot core with colored edge
        vec3 core = vec3(1.0, 1.0, 0.95);
        vec3 color = mix(vColor, core, glow * 0.7);
        
        gl_FragColor = vec4(color, glow * vAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Solar Tendril Shaders - Flowing flare ropes
// ─────────────────────────────────────────────────────────────────────────────

export const tendrilVertexShader = `
    attribute float aProgress; // 0 = base, 1 = tip
    attribute float aTendrilId;
    
    uniform float uTime;
    uniform float uIntensity;
    uniform vec3 uBasePosition;
    
    varying float vProgress;
    varying float vAlpha;

    void main() {
        vProgress = aProgress;
        
        // Sinusoidal wave motion along tendril
        float wave = sin(aProgress * 6.0 + uTime * 2.0 + aTendrilId * 1.5) * 15.0;
        float wave2 = sin(aProgress * 10.0 - uTime * 3.0 + aTendrilId * 2.0) * 8.0;
        
        vec3 pos = position;
        pos.x += wave * aProgress;
        pos.y += wave2 * aProgress;
        
        // Extend based on intensity
        float extension = 1.0 + uIntensity * 0.5;
        pos = mix(uBasePosition, pos, extension);
        
        // Fade tip
        vAlpha = 1.0 - pow(aProgress, 2.0);
        vAlpha *= 0.8 + 0.2 * sin(uTime * 3.0);
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

export const tendrilFragmentShader = `
    uniform float uTime;
    
    varying float vProgress;
    varying float vAlpha;

    void main() {
        // Color gradient: white-hot at base -> orange at tip
        vec3 baseColor = vec3(1.0, 1.0, 0.9);
        vec3 tipColor = vec3(1.0, 0.4, 0.1);
        vec3 color = mix(baseColor, tipColor, vProgress);
        
        // Shimmer effect
        float shimmer = 0.9 + 0.1 * sin(vProgress * 20.0 + uTime * 8.0);
        
        gl_FragColor = vec4(color * shimmer, vAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Diamond Ring Effect Shaders
// ─────────────────────────────────────────────────────────────────────────────

export const diamondRingVertexShader = `
    varying vec2 vUv;
    
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const diamondRingFragmentShader = `
    uniform float uTime;
    uniform float uEclipseProgress; // 0 = no eclipse, 1 = perfect alignment
    uniform float uMoonX; // Moon's X position relative to sun
    
    varying vec2 vUv;

    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        
        // Ring around moon edge
        float moonRadius = 0.35;
        float ringDist = abs(dist - moonRadius);
        float ring = smoothstep(0.03, 0.0, ringDist);
        
        // Diamond point on the side opposite moon motion
        float angle = atan(center.y, center.x);
        float diamondAngle = uMoonX > 0.0 ? 3.14159 : 0.0; // Opposite side
        float angleDiff = abs(angle - diamondAngle);
        if (angleDiff > 3.14159) angleDiff = 6.28318 - angleDiff;
        
        float diamond = smoothstep(0.4, 0.0, angleDiff) * ring;
        diamond = pow(diamond, 0.5); // Intense bright spot
        
        // Only visible during near-perfect eclipse
        float visibility = smoothstep(0.7, 1.0, uEclipseProgress);
        
        // Baily's beads - multiple smaller bright spots
        float beads = 0.0;
        for (int i = 0; i < 5; i++) {
            float beadAngle = float(i) * 1.25 + uTime * 0.1;
            float beadDiff = abs(angle - beadAngle);
            if (beadDiff > 3.14159) beadDiff = 6.28318 - beadDiff;
            beads += smoothstep(0.15, 0.0, beadDiff) * ring * 0.3;
        }
        
        float brightness = (diamond * 2.0 + beads + ring * 0.2) * visibility;
        
        // White-gold color
        vec3 color = mix(vec3(1.0, 0.95, 0.8), vec3(1.0), brightness);
        
        gl_FragColor = vec4(color, brightness * 0.9);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Chromatic Aberration Post-Processing Shader
// ─────────────────────────────────────────────────────────────────────────────

export const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.003 },
        uTime: { value: 0 },
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
        varying vec2 vUv;

        void main() {
            vec2 center = vUv - 0.5;
            float dist = length(center);
            
            // Radial chromatic aberration - stronger at edges
            float aberration = dist * dist * uIntensity;
            
            // Slight pulsing
            aberration *= 0.9 + 0.1 * sin(uTime * 0.5);
            
            vec2 dir = normalize(center);
            
            // Sample each color channel at slightly offset positions
            float r = texture2D(tDiffuse, vUv + dir * aberration).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - dir * aberration).b;
            
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Cosmic Rift Shaders - Energy tears during high combos
// ─────────────────────────────────────────────────────────────────────────────

export const cosmicRiftVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const cosmicRiftFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    varying vec2 vUv;

    // Simple noise function
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
        // Tapered horizontal edges
        float edgeFade = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
        
        // Core glow - narrow vertical band
        float centerFade = 1.0 - abs(vUv.y - 0.5) * 4.0;
        centerFade = max(0.0, centerFade);
        centerFade = pow(centerFade, 1.5);
        
        // Electric crackle effect
        float crackle = hash(vUv * 50.0 + uTime * 5.0);
        crackle = smoothstep(0.7, 0.9, crackle) * centerFade;
        
        // Lightning bolts
        float lightning = sin(vUv.x * 30.0 + uTime * 12.0) * 0.5 + 0.5;
        lightning *= smoothstep(0.4, 0.5, vUv.y) * smoothstep(0.6, 0.5, vUv.y);
        
        float alpha = (centerFade + crackle * 0.5 + lightning * 0.3) * edgeFade * uOpacity;
        
        // Orange-gold color gradient (eclipse themed)
        vec3 coreColor = vec3(1.0, 0.9, 0.7);
        vec3 edgeColor = vec3(1.0, 0.5, 0.2);
        vec3 color = mix(edgeColor, coreColor, centerFade);
        
        gl_FragColor = vec4(color, alpha * 0.7);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Meteor Crash Effect Shaders
// ─────────────────────────────────────────────────────────────────────────────

// Impact Flash
export const impactFlashVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const impactFlashFragmentShader = `
    uniform float uProgress;
    varying vec2 vUv;
    
    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        
        // Flash expands outward then fades
        float flashRadius = uProgress * 0.6;
        float flash = smoothstep(flashRadius + 0.15, flashRadius, dist);
        flash *= (1.0 - uProgress);
        flash = pow(flash, 0.4);
        
        // Orange-gold flash color
        vec3 color = mix(vec3(1.0, 0.7, 0.3), vec3(1.0, 1.0, 0.9), flash);
        
        gl_FragColor = vec4(color, flash * 0.9);
    }
`;

// Debris Particles
export const debrisVertexShader = `
    attribute vec3 aVelocity;
    attribute float aSize;
    attribute float aRotation;
    
    uniform float uTime;
    uniform float uPixelRatio;
    
    varying float vAlpha;
    varying float vTwinkle;
    
    void main() {
        vec3 pos = position;
        pos += aVelocity * uTime;
        pos.y -= 150.0 * uTime * uTime; // Gravity
        
        // Fade out over 2.5 seconds
        vAlpha = 1.0 - smoothstep(0.0, 2.5, uTime);
        
        // Twinkle effect
        vTwinkle = 0.7 + 0.3 * sin(uTime * 10.0 + aRotation * 8.0);
        
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
        
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.3);
        
        // Warm orange-gold debris
        vec3 core = vec3(1.0, 0.95, 0.85);
        vec3 halo = vec3(1.0, 0.6, 0.3);
        vec3 color = mix(halo, core, glow);
        
        gl_FragColor = vec4(color, glow * vAlpha * vTwinkle);
    }
`;

// Shockwave Ring
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
        
        // Expanding ring
        float ringRadius = uProgress * 1.2;
        float ringWidth = 0.12 * (1.0 - uProgress * 0.5);
        
        float ring = smoothstep(ringRadius - ringWidth, ringRadius - ringWidth * 0.5, dist)
                   * smoothstep(ringRadius + ringWidth * 0.5, ringRadius, dist);
        
        float fade = (1.0 - uProgress) * uOpacity;
        
        // Orange-gold shockwave
        vec3 color = vec3(1.0, 0.7, 0.4);
        
        gl_FragColor = vec4(color, ring * fade);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Lens Flare Shaders
// ─────────────────────────────────────────────────────────────────────────────

export const lensFlareVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const lensFlareFragmentShader = `
    uniform float uTime;
    uniform float uIntensity;
    uniform vec2 uSunPosition; // Normalized screen position of sun
    
    varying vec2 vUv;

    float hexagon(vec2 p, float size) {
        vec2 q = abs(p);
        return max(q.x * 0.866 + q.y * 0.5, q.y) - size;
    }

    void main() {
        vec2 center = vUv - 0.5;
        vec2 sunDir = normalize(uSunPosition - 0.5);
        float sunDist = length(uSunPosition - 0.5);
        
        float flare = 0.0;
        
        // Multiple ghost hexagons along sun-center axis
        for (int i = 1; i < 6; i++) {
            float fi = float(i);
            vec2 ghostPos = center + sunDir * fi * 0.15;
            float ghostSize = 0.02 + fi * 0.01;
            float ghost = smoothstep(ghostSize + 0.01, ghostSize, abs(hexagon(ghostPos, ghostSize)));
            ghost *= (1.0 - fi * 0.15); // Fade further ghosts
            flare += ghost * 0.15;
        }
        
        // Central streak
        float streak = exp(-abs(dot(center, vec2(-sunDir.y, sunDir.x))) * 20.0);
        streak *= exp(-length(center) * 3.0);
        flare += streak * 0.3;
        
        // Halo around sun position
        float haloSize = 0.15 + 0.02 * sin(uTime * 2.0);
        float halo = smoothstep(haloSize + 0.05, haloSize, length(center - (uSunPosition - 0.5) * 0.3));
        flare += halo * 0.2;
        
        flare *= uIntensity;
        
        // Warm colors
        vec3 color = mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.95, 0.9), flare);
        
        gl_FragColor = vec4(color, flare * 0.6);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Vignette Shader (Enhanced for Solar Eclipse)
// ─────────────────────────────────────────────────────────────────────────────

export const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.6 },
        offset: { value: 1.2 },
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
            float vig = smoothstep(offset, offset - 0.6, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Occluded Particle Shaders - Standard particles that are masked by the Moon
// ─────────────────────────────────────────────────────────────────────────────

export const occludedParticleVertexShader = `
    attribute float size;

    uniform float uPixelRatio;
    uniform vec3 uMoonPosition;
    uniform float uMoonRadius;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        vColor = color;
        vAlpha = 1.0;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        
        // Occlusion Logic - Hide if overlapping Moon disk
        // Assuming particles are in World Space (scene child)
        float distToMoon = distance(position.xy, uMoonPosition.xy);
        if (distToMoon < uMoonRadius) {
            vAlpha = 0.0;
        }

        gl_PointSize = size * uPixelRatio * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const occludedParticleFragmentShader = `
    uniform float opacity;
    
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
        if (vAlpha <= 0.01) discard;

        // Soft circular particle
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        if (dist > 0.5) discard;
        
        float soft = 1.0 - smoothstep(0.0, 0.5, dist);

        gl_FragColor = vec4(vColor, opacity * vAlpha * soft);
    }
`;
