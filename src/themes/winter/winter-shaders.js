/**
 * Winter Theme Shaders
 * Enhanced shader collection for the most mesmerizing winter theme
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ice Wisp Shaders (Floating Spirit Particles)
// ─────────────────────────────────────────────────────────────────────────────

export const iceWispVertexShader = `
    attribute float aPhase;
    attribute float aSpeed;
    attribute float aSize;
    attribute float aBrightness;
    attribute float aTrail;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uSurgeIntensity;

    varying float vAlpha;
    varying float vBrightness;

    void main() {
        // Floating sine wave animation - ethereal movement
        vec3 pos = position;
        float trailFade = pow(1.0 - aTrail, 1.4);
        float t = (uTime - aTrail * 1.2) * aSpeed + aPhase;
        
        // Gentle upward drift with horizontal sway
        pos.y += sin(t * 0.8) * 15.0 + uTime * 3.0; // Slow rise
        pos.x += cos(t * 0.5) * 20.0 + sin(t * 0.3) * 10.0;
        pos.z += sin(t * 0.4) * 8.0;

        // Wrap particles that go too high
        if (pos.y > 400.0) pos.y -= 500.0;

        // Fade based on height and time pulse
        float heightFade = smoothstep(-100.0, 100.0, pos.y) * smoothstep(400.0, 200.0, pos.y);
        float pulseFade = 0.4 + sin(t * 2.0) * 0.3;
        vAlpha = heightFade * pulseFade * (1.0 + uSurgeIntensity * 0.8) * trailFade;
        vBrightness = aBrightness * (1.0 + uSurgeIntensity * 0.5) * mix(0.35, 1.0, trailFade);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float trailScale = mix(0.5, 1.0, trailFade);
        gl_PointSize = aSize * uPixelRatio * (1.0 + uSurgeIntensity * 0.4) * trailScale * (500.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const iceWispFragmentShader = `
    varying float vAlpha;
    varying float vBrightness;

    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;

        // Soft ethereal glow with ice-blue core
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.2);

        // Ice-blue to cyan color gradient
        vec3 coreColor = vec3(0.7, 0.95, 1.0);
        vec3 haloColor = vec3(0.4, 0.7, 0.9);
        vec3 color = mix(haloColor, coreColor, glow) * vBrightness;

        gl_FragColor = vec4(color, glow * vAlpha * 0.7);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Shooting Star / Comet Shaders
// ─────────────────────────────────────────────────────────────────────────────

export const cometTrailVertexShader = `
    attribute float aTrailPosition;
    
    uniform float uTime;
    uniform float uProgress;
    
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

export const cometTrailFragmentShader = `
    uniform float uTime;
    uniform float uProgress;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    
    void main() {
        // Trail fades from bright head to dim tail
        float trailFade = pow(1.0 - vTrailPos, 2.5);
        
        // Subtle shimmer
        float shimmer = 0.95 + 0.05 * sin(vTrailPos * 30.0 + uTime * 10.0);
        
        // Color: ice-blue head transitioning to faint cyan tail
        vec3 headColor = vec3(0.9, 0.98, 1.0);
        vec3 tailColor = vec3(0.4, 0.7, 0.95);
        vec3 color = mix(headColor, tailColor, vTrailPos);
        
        float alpha = trailFade * vLifeAlpha * shimmer;
        
        gl_FragColor = vec4(color, alpha);
    }
`;

export const cometHeadVertexShader = `
    uniform float uProgress;
    uniform float uPixelRatio;
    
    varying float vLifeAlpha;
    
    void main() {
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.6, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 15.0 * uPixelRatio;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const cometHeadFragmentShader = `
    varying float vLifeAlpha;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5) * 2.0;
        if (dist > 1.0) discard;
        
        float glow = 1.0 - dist;
        glow = pow(glow, 1.5);
        
        // Bright white-blue core with cyan halo
        vec3 core = vec3(1.0, 1.0, 1.0);
        vec3 halo = vec3(0.7, 0.9, 1.0);
        vec3 color = mix(halo, core, glow);
        
        gl_FragColor = vec4(color, glow * vLifeAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Ice Crystal Crash Shaders
// ─────────────────────────────────────────────────────────────────────────────

export const iceCrystalHeadVertexShader = `
    uniform float uProgress;
    uniform float uPixelRatio;
    
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.9, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        vIntensity = 1.0 + uProgress * 0.8;
        
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 25.0 * uPixelRatio * (1.0 + uProgress * 0.3);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const iceCrystalHeadFragmentShader = `
    varying float vLifeAlpha;
    varying float vIntensity;
    
    void main() {
        float dist = length(gl_PointCoord - 0.5) * 2.0;
        if (dist > 1.0) discard;
        
        float glow = 1.0 - dist;
        glow = pow(glow, 1.2);
        
        // Brilliant ice-blue core
        vec3 core = vec3(0.85, 0.95, 1.0);
        vec3 halo = vec3(0.5, 0.8, 1.0);
        vec3 color = mix(halo, core, glow) * vIntensity;
        
        gl_FragColor = vec4(color, glow * vLifeAlpha);
    }
`;

export const iceCrystalTrailVertexShader = `
    attribute float aTrailPosition;
    
    uniform float uTime;
    uniform float uProgress;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    
    void main() {
        vTrailPos = aTrailPosition;
        
        float fadeIn = smoothstep(0.0, 0.1, uProgress);
        float fadeOut = smoothstep(1.0, 0.85, uProgress);
        vLifeAlpha = fadeIn * fadeOut;
        
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const iceCrystalTrailFragmentShader = `
    uniform float uTime;
    
    varying float vTrailPos;
    varying float vLifeAlpha;
    
    void main() {
        float trailFade = pow(1.0 - vTrailPos, 2.0);
        float shimmer = 0.9 + 0.1 * sin(vTrailPos * 40.0 + uTime * 15.0);
        
        vec3 headColor = vec3(0.9, 0.98, 1.0);
        vec3 tailColor = vec3(0.3, 0.6, 0.9);
        vec3 color = mix(headColor, tailColor, vTrailPos);
        
        float alpha = trailFade * vLifeAlpha * shimmer;
        
        gl_FragColor = vec4(color, alpha * 0.8);
    }
`;

export const iceShardDebrisVertexShader = `
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
        
        // Sparkle effect
        vTwinkle = 0.6 + 0.4 * sin(uTime * 12.0 + aRotation * 8.0);
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * vAlpha * (1.0 + vTwinkle * 0.3);
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const iceShardDebrisFragmentShader = `
    varying float vAlpha;
    varying float vTwinkle;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        float glow = 1.0 - smoothstep(0.0, 1.0, dist);
        glow = pow(glow, 1.3);
        
        // Ice shard colors - bright cyan with white sparkle
        vec3 core = vec3(1.0, 1.0, 1.0);
        vec3 halo = vec3(0.6, 0.85, 1.0);
        vec3 color = mix(halo, core, glow * vTwinkle);
        
        gl_FragColor = vec4(color, glow * vAlpha * vTwinkle);
    }
`;

export const frostRingShockwaveVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const frostRingShockwaveFragmentShader = `
    uniform float uProgress;
    uniform float uOpacity;
    
    varying vec2 vUv;
    
    void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center) * 2.0;
        
        float ringRadius = uProgress * 1.3;
        float ringWidth = 0.12 * (1.0 - uProgress * 0.6);
        
        float ring = smoothstep(ringRadius - ringWidth, ringRadius - ringWidth * 0.5, dist)
                   * smoothstep(ringRadius + ringWidth * 0.5, ringRadius, dist);
        
        // Add frost pattern
        float frost = sin(dist * 30.0 + uProgress * 20.0) * 0.1 + 0.9;
        
        float fade = (1.0 - uProgress) * uOpacity;
        
        // Ice-blue color
        vec3 color = vec3(0.7, 0.9, 1.0);
        
        gl_FragColor = vec4(color, ring * fade * frost);
    }
`;

export const iceMistVertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute vec3 aVelocity;
    
    uniform float uTime;
    uniform float uPixelRatio;
    
    varying float vAlpha;
    
    void main() {
        vec3 pos = position;
        float t = uTime;
        
        pos += aVelocity * t;
        pos.y += sin(t * 1.5 + aPhase) * 15.0;
        pos.x += cos(t * 1.2 + aPhase) * 12.0;
        pos.y += t * 25.0; // Rise
        
        float fadeIn = smoothstep(0.0, 0.3, uTime);
        float fadeOut = smoothstep(3.0, 1.5, uTime);
        vAlpha = fadeIn * fadeOut * 0.35;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        float grow = 1.0 + uTime * 0.8;
        gl_PointSize = aSize * uPixelRatio * grow;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const iceMistFragmentShader = `
    varying float vAlpha;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0;
        
        float soft = 1.0 - smoothstep(0.0, 1.0, dist);
        soft = pow(soft, 0.7);
        
        // Faint ice-blue mist
        vec3 color = vec3(0.6, 0.75, 0.85);
        
        gl_FragColor = vec4(color, soft * vAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Blizzard Wave Shader
// ─────────────────────────────────────────────────────────────────────────────

export const blizzardWaveVertexShader = `
    attribute float aSize;
    attribute float aPhase;
    attribute float aSpeed;
    
    uniform float uTime;
    uniform float uProgress;
    uniform float uDirection; // 1.0 = right, -1.0 = left
    uniform float uPixelRatio;
    
    varying float vAlpha;
    
    void main() {
        vec3 pos = position;
        
        // Horizontal sweep with turbulence
        float sweep = uProgress * 1500.0 * uDirection;
        pos.x += sweep;
        pos.y += sin(uTime * 8.0 + aPhase) * 20.0;
        pos.z += cos(uTime * 6.0 + aPhase) * 10.0;
        
        // Fade based on progress
        float fadeIn = smoothstep(0.0, 0.2, uProgress);
        float fadeOut = smoothstep(1.0, 0.6, uProgress);
        vAlpha = fadeIn * fadeOut * 0.7;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * aSpeed;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const blizzardWaveFragmentShader = `
    varying float vAlpha;
    
    void main() {
        vec2 coord = gl_PointCoord - 0.5;
        float dist = length(coord) * 2.0;
        
        // Elongated horizontal for wind streak
        float streak = 1.0 - smoothstep(0.0, 1.0, dist);
        
        vec3 color = vec3(0.9, 0.95, 1.0);
        gl_FragColor = vec4(color, streak * vAlpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Volumetric Fog Shader
// ─────────────────────────────────────────────────────────────────────────────

export const volumetricFogVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const volumetricFogFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uSpeed;
    
    varying vec2 vUv;
    
    // Simple noise function
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
        vec2 uv = vUv;
        uv.x += uTime * uSpeed;
        
        float fog = fbm(uv * 3.0 + uTime * 0.03) + fbm(uv * 5.0 - uTime * 0.02) * 0.5;
        fog = fog * 0.5 + 0.5;
        
        // Edge fade
        float vertFade = smoothstep(0.0, 0.3, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
        float horizFade = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
        
        float groundBoost = (1.0 - smoothstep(0.2, 0.8, vUv.y)) * 0.4 + 0.45;
        
        // Deep midnight fog
        vec3 color = vec3(0.12, 0.16, 0.22);
        
        gl_FragColor = vec4(color, fog * vertFade * horizFade * groundBoost * uOpacity);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Moon Ray Shader
// ─────────────────────────────────────────────────────────────────────────────

export const moonRayVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const moonRayFragmentShader = `
    uniform float uTime;
    uniform float uOpacity;
    uniform float uIntensity;
    
    varying vec2 vUv;
    
    void main() {
        // Vertical beam from top
        float distFromCenter = abs(vUv.x - 0.5) * 2.0;
        float beam = exp(-distFromCenter * distFromCenter * 8.0);
        
        // Fade toward bottom
        float vertFade = smoothstep(1.0, 0.0, vUv.y);
        
        // Subtle shimmer
        float shimmer = 0.9 + 0.1 * sin(vUv.y * 30.0 + uTime * 3.0);
        
        float alpha = beam * vertFade * uOpacity * shimmer * uIntensity;
        
        // Soft moonlight color
        vec3 color = vec3(0.85, 0.9, 1.0);
        
        gl_FragColor = vec4(color, alpha * 0.4);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Aurora Pulse Wave Shader
// ─────────────────────────────────────────────────────────────────────────────

export const auroraPulseVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const auroraPulseFragmentShader = `
    uniform float uTime;
    uniform float uProgress;
    
    varying vec2 vUv;
    
    void main() {
        // Ripple from center
        float dist = abs(vUv.x - 0.5) * 2.0;
        float wave = sin((dist - uProgress * 2.0) * 10.0);
        wave = max(0.0, wave);
        wave *= smoothstep(2.0, 0.0, abs(dist - uProgress * 2.0));
        
        // Fade with progress
        float fade = 1.0 - uProgress;
        
        vec3 color = vec3(0.2, 0.9, 0.6);
        gl_FragColor = vec4(color, wave * fade * 0.5);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Frost Snap Shader (Piece Lock)
// ─────────────────────────────────────────────────────────────────────────────

export const frostSnapVertexShader = `
    attribute float aSize;
    attribute vec3 aVelocity;
    
    uniform float uTime;
    uniform float uPixelRatio;
    
    varying float vAlpha;
    
    void main() {
        vec3 pos = position;
        pos += aVelocity * uTime * 200.0; // Fast expansion
        
        float life = 1.0 - smoothstep(0.0, 0.4, uTime); // Short life
        vAlpha = life;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_PointSize = aSize * uPixelRatio * life;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const frostSnapFragmentShader = `
    varying float vAlpha;
    
    void main() {
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center) * 2.0; // Circular
        if (dist > 1.0) discard;
        
        float glow = 1.0 - dist;
        glow = pow(glow, 2.0); // Sharp falloff
        
        // Crisp white/cyan
        vec3 color = vec3(0.9, 0.98, 1.0);
        
        gl_FragColor = vec4(color, glow * vAlpha);
    }
`;
