/**
 * Neon Dusk Theme - GLSL Shaders for Three.js
 *
 * A synthwave masterpiece featuring:
 * - Gradient sky with twinkling stars
 * - Procedural FBM mountains with neon rim lighting
 * - Multi-layer glowing sun
 * - Perspective synthwave grid
 * - Dynamic particle effects
 * - VHS/CRT post-processing
 */

// ============================================================================
// SKY GRADIENT SHADERS
// ============================================================================

export const skyVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragmentShader = `
uniform vec3 uColorTop;
uniform vec3 uColorMid;
uniform vec3 uColorBottom;

varying vec2 vUv;

void main() {
    float y = vUv.y;

    // Three-color gradient: bottom (orange) -> mid (magenta) -> top (purple)
    vec3 color;
    if (y < 0.4) {
        color = mix(uColorBottom, uColorMid, y / 0.4);
    } else {
        color = mix(uColorMid, uColorTop, (y - 0.4) / 0.6);
    }

    gl_FragColor = vec4(color, 1.0);
}
`;

// ============================================================================
// STARFIELD SHADERS
// ============================================================================

export const starVertexShader = `
attribute float aSize;
attribute vec2 aTwinkle;  // x: phase, y: speed
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
    vBrightness = aBrightness * (0.6 + twinkle * 0.4);
    vBrightness *= (1.0 + uEventBoost * 0.5);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Size attenuation with distance - keep stars small
    gl_PointSize = aSize * uPixelRatio * (150.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 25.0);

    gl_Position = projectionMatrix * mvPosition;
}
`;

export const starFragmentShader = `
varying vec3 vColor;
varying float vBrightness;

void main() {
    // Soft circular point with glow
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center) * 2.0;

    // Soft circular falloff
    float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);
    softCircle = pow(softCircle, 2.0);

    // Core brightness - keep it subtle
    vec3 coreColor = vColor * vBrightness * 0.8;
    float alpha = softCircle * vBrightness * 0.7;

    gl_FragColor = vec4(coreColor, alpha);
}
`;

// ============================================================================
// NEBULA CLOUD SHADERS
// ============================================================================

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
uniform float uTime;

varying vec2 vUv;

void main() {
    vec4 texColor = texture2D(tDiffuse, vUv);

    // Aggressive edge fade - only center is fully visible
    float fadeX = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
    float fadeY = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
    float fade = fadeX * fadeY;
    fade = pow(fade, 1.5);

    // Pulse effect from gameplay events
    float alpha = texColor.a * (uOpacity + uPulse * 0.1) * fade;

    // Neon color tint
    vec3 color = texColor.rgb * (1.0 + uPulse * 0.4);

    gl_FragColor = vec4(color, alpha);
}
`;

// ============================================================================
// SUN SHADERS
// ============================================================================

export const sunVertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunFragmentShader = `
uniform float uTime;
uniform vec3 uColorTop;
uniform vec3 uColorMid;
uniform vec3 uColorBottom;
uniform float uPulseIntensity;
uniform float uStripeCount;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
    // Smooth vertical gradient through colors
    float y = vUv.y;
    vec3 baseColor;
    
    // Sharper gradient transition for that retro look
    if (y < 0.5) {
        baseColor = mix(uColorBottom, uColorMid, y * 2.0);
    } else {
        baseColor = mix(uColorMid, uColorTop, (y - 0.5) * 2.0);
    }

    // === RETRO SUN STRIPES ===
    float stripeAlpha = 1.0;
    
    // Only stripe the bottom half (mostly)
    if (y < 0.6) {
        // Variable frequency stripes - thinner at top, thicker at bottom
        // This creates the perspective effect on the sun itself
        float stripePhase = pow(1.0 - y, 2.5) * uStripeCount * 3.0; // Non-linear spacing
        
        // Sharp cuts
        float pattern = fract(stripePhase);
        float stripe = step(0.5, pattern); // Hard steps, no smoothstep
        
        // Fade stripes out towards the middle to blend with solid top
        float blend = smoothstep(0.5, 0.6, y);
        stripeAlpha = mix(stripe, 1.0, blend);
    }

    // Fresnel for soft edge glow
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 3.0);

    // Combine color with stripes
    vec3 finalColor = baseColor;
    finalColor += finalColor * uPulseIntensity * 0.4;
    
    // Add inner glow
    finalColor += vec3(1.0, 0.8, 0.5) * fresnel * 0.5;

    // Soft circular mask for the edge
    gl_FragColor = vec4(finalColor, stripeAlpha);
}
`;

// ============================================================================
// SUN GLOW LAYER SHADERS
// ============================================================================

export const sunGlowVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunGlowFragmentShader = `
uniform vec3 uGlowColor;
uniform float uOpacity;
uniform float uPulseIntensity;

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;

    // Radial gradient with soft falloff
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    glow = pow(glow, 2.0);

    // Pulse effect
    glow += glow * uPulseIntensity * 0.3;

    gl_FragColor = vec4(uGlowColor, glow * uOpacity);
}
`;

// ============================================================================
// MOUNTAIN SHADERS (Detailed with Rim Lighting)
// ============================================================================

export const mountainVertexShader = `
uniform float uTime;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying float vHeight;

void main() {
    vNormal = normalize(normalMatrix * normal);

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    vHeight = position.y; // Local height for gradient

    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const mountainFragmentShader = `
uniform vec3 uBaseColor;
uniform vec3 uRimColor;
uniform float uMountainLayer;
uniform float uTime;

varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewDir;
varying float vHeight;

// Simplex noise for detail texture
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                      0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                     -0.577350269189626,  // -1.0 + 2.0 * C.x
                      0.024390243902439); // 1.0 / 41.0
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i); // Avoid truncation effects in permutation
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

void main() {
    // 1. Base Gradient (Dark purple/blue based on height)
    // Map height 0-150 to a color gradient
    float heightFactor = smoothstep(0.0, 150.0, vHeight);
    vec3 detailColor = mix(uBaseColor, uRimColor * 0.3, heightFactor); // Tips are lighter
    
    // 2. Texture/Noise Detail
    float noiseVal = snoise(vWorldPosition.xz * 0.03 + uTime * 0.05); 
    noiseVal = snoise(vWorldPosition.xz * 0.02);
    detailColor += uRimColor * max(0.0, noiseVal) * 0.1 * heightFactor;

    // 3. Rim Lighting
    float fresnel = 1.0 - max(dot(vNormal, vViewDir), 0.0);
    fresnel = pow(fresnel, 3.0);
    
    // Rim light mostly on top
    float topLight = smoothstep(40.0, 150.0, vHeight); 
    vec3 rim = uRimColor * fresnel * topLight * 2.5;

    // 4. Ground Fog (Dark mist against the grid)
    // Creates a smooth dark transitions at the bottom without losing all detail
    float groundFog = 1.0 - smoothstep(-10.0, 80.0, vHeight);
    vec3 gridFogColor = vec3(0.02, 0.0, 0.05); // Very dark purple/black fog
    
    vec3 finalColor = mix(detailColor, gridFogColor, groundFog * 0.9); // Heavy fog at very bottom

    // Rim cuts through a bit, but fades in deep fog
    finalColor += rim * (1.0 - groundFog * 0.6);

    // 5. Distance Fade (Global Atmosphere)
    float dist = length(vWorldPosition.xz);
    float fogFactor = smoothstep(200.0, 900.0, dist);
    vec3 fogColor = vec3(0.1, 0.05, 0.2); // Global haze
    
    finalColor = mix(finalColor, fogColor, fogFactor * 0.7);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ============================================================================
// GRID SHADERS (Synthwave Perspective Grid with Reflections)
// ============================================================================

export const gridVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewPos;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    
    vec4 mvPosition = viewMatrix * worldPosition;
    vViewPos = -mvPosition.xyz;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const gridFragmentShader = `
uniform float uTime;
uniform float uSpeed;
uniform vec3 uGridColor;
uniform float uGlowIntensity;
uniform float uPulseIntensity;
uniform vec3 uColorShift;
uniform vec3 uSunPosition; // Added for reflection

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vViewPos;

void main() {
    // Grid line calculation with scrolling
    float gridSpacing = 6.0; // Increased from 3.0 for larger cells
    float lineWidth = 0.08;  // Slightly thicker lines for larger grid

    // Scroll Z coordinate
    float scrolledZ = vWorldPos.z - uTime * uSpeed;

    // Calculate distance to nearest grid line
    float gridX = abs(fract(vWorldPos.x / gridSpacing + 0.5) - 0.5) * gridSpacing;
    float gridZ = abs(fract(scrolledZ / gridSpacing + 0.5) - 0.5) * gridSpacing;

    // Create grid lines
    float lineX = smoothstep(lineWidth * 2.5, 0.0, gridX);
    float lineZ = smoothstep(lineWidth * 2.5, 0.0, gridZ);
    float gridLine = max(lineX, lineZ);

    // Distance fade
    float dist = length(vWorldPos.xz);
    // Even shorter fade distance - Aggressively dark closer to camera
    float distanceFade = 1.0 - smoothstep(10.0, 80.0, dist); 
    float horizonFade = smoothstep(200.0, 50.0, dist); // Fade out at very far distance

    // Perspective fade
    float perspectiveFade = 1.0 - smoothstep(0.0, 200.0, -vWorldPos.z);

    // --- REFLECTION LOGIC ---
    // Calculate reflection of the sun on the grid floor ("wet road" look)
    vec3 viewDir = normalize(vViewPos);
    vec3 sunDir = normalize(uSunPosition - vWorldPos);
    
    // Simple specular reflection on the floor plane (normal is roughly 0,1,0)
    // But since this is a 2D plane shader, we approximate.
    // We want a highlight along the Z-axis aligned with the sun's X
    
    float sunX = uSunPosition.x;
    float sunWidth = 100.0; // Width of the reflection path
    
    // Distance from the center path (Sun is usually at x=0)
    float pathDist = abs(vWorldPos.x - sunX);
    
    // Intensity of reflection based on alignment with sun
    float reflection = 1.0 - smoothstep(0.0, sunWidth, pathDist);
    reflection = pow(reflection, 2.0) * 0.5; // Narrow and intensify
    
    // REMOVED NOISE to prevent flickering/aliasing in the distance
    // float roadNoise = sin(vWorldPos.x * 0.5) * sin(vWorldPos.z * 0.5);
    // reflection *= (0.8 + 0.2 * roadNoise);

    // Grid Glow + Reflection
    
    // Mix grid color with shift color
    vec3 baseGridColor = mix(uGridColor, uColorShift, uPulseIntensity * 0.5);
    
    // Add reflection color (Sun color approx - smooth gradient)
    vec3 reflectionColor = vec3(1.0, 0.5, 0.8); 
    
    // Distance-based line thickness to reduce aliasing
    // Thicken lines MORE aggressively in the distance
    // Distance-based line thickness to reduce aliasing
    // Thicken lines MORE aggressively and SOONER in the distance
    float distFactor = smoothstep(20.0, 100.0, dist); // Start thickening at 20 (was 50)
    float thicknessMod = 1.0 + distFactor * 6.0; // Increased max thickness multiplier from 4.0 to 6.0
    
    // Re-calculate grid lines with modified thickness
    float modLineX = smoothstep(lineWidth * 2.5 * thicknessMod, 0.0, gridX);
    float modLineZ = smoothstep(lineWidth * 2.5 * thicknessMod, 0.0, gridZ);
    float modGridLine = max(modLineX, modLineZ);
    
    vec3 finalColor = baseGridColor * modGridLine;
    
    // SMOOTHER REFLECTION:
    // 1. Floor Glow (Fill the gaps) - Stronger
    finalColor += reflectionColor * reflection * 0.6 * horizonFade; 
    
    // 2. Line Boost - Weaker and faded with distance
    vec3 lineReflection = reflectionColor * modGridLine * reflection * 1.5;
    
    // Fade out line reflection at distance to prevent sparkling
    // Aggressive fade: starts at 10, completely gone by 60
    float lineDistFade = 1.0 - smoothstep(10.0, 60.0, dist);
    finalColor += lineReflection * (1.0 - distFactor) * lineDistFade;

    // Combine intensities
    float intensity = (modGridLine * uGlowIntensity) + (reflection * 0.4);
    intensity *= distanceFade * perspectiveFade;

    float alpha = intensity;
    
    // Clamp alpha but allow glow to bloom
    alpha = min(alpha, 1.0);
    
    // IMPROVED SCANLINE EFFECT - DISTANCE FADED
    // Only apply scanlines closer to camera to prevent distant moiré/flickering
    // Aggressive fade: starts at 0, gone by 40
    float scanlineFade = 1.0 - smoothstep(0.0, 40.0, dist);
    if (scanlineFade > 0.01) {
        float scanline = 0.95 + 0.05 * sin(scrolledZ * 8.0 - uTime * 2.0);
        alpha *= mix(1.0, scanline, scanlineFade);
    }
    
    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ============================================================================
// GRID HIGHLIGHT SHADERS (Tetromino Cell Highlights)
// ============================================================================

export const highlightVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const highlightFragmentShader = `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uTwinkle;

varying vec2 vUv;

void main() {
    // Edge glow effect
    vec2 center = vUv - 0.5;
    float edge = max(abs(center.x), abs(center.y));
    float edgeGlow = smoothstep(0.35, 0.5, edge);

    // Inner fill
    float fill = 1.0 - smoothstep(0.0, 0.4, edge);

    // Chromatic edge enhancement
    vec3 chromatic = uColor;
    chromatic.r += edgeGlow * 0.3;
    chromatic.b += edgeGlow * 0.2;

    // Pulse animation
    float pulse = sin(uTime * 3.0) * 0.1 + 1.0;

    // Twinkle effect during combos
    float twinkle = 1.0 + sin(uTime * 15.0 + uTwinkle) * uTwinkle * 0.3;

    vec3 finalColor = chromatic * uIntensity * pulse * twinkle;
    float alpha = (fill * 0.5 + edgeGlow * 0.9) * uIntensity;

    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ============================================================================
// PARTICLE SHADERS (Ambient, Burst, Rising Squares)
// ============================================================================

export const particleVertexShader = `
attribute float aSize;
attribute float aLife;
attribute float aType;  // 0: circle, 1: ring, 2: square

uniform float uTime;
uniform float uPixelRatio;

varying float vLife;
varying float vType;
varying vec3 vColor;

void main() {
    vLife = aLife;
    vType = aType;
    vColor = color;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Size based on life and type
    float sizeMult = aType == 2.0 ? 1.5 : 1.0;  // Squares are larger
    gl_PointSize = aSize * aLife * sizeMult * uPixelRatio * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 80.0);

    gl_Position = projectionMatrix * mvPosition;
}
`;

export const particleFragmentShader = `
varying float vLife;
varying float vType;
varying vec3 vColor;
uniform float uTwinkle;

void main() {
    float alpha = 0.0;

    if (vType < 0.5) {
        // Type 0: Soft circle
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        alpha = (1.0 - dist * 2.0) * vLife;
        alpha = pow(max(0.0, alpha), 1.5);
        gl_FragColor = vec4(vColor * (1.0 + vLife * 0.5), alpha);
    } else if (vType < 1.5) {
        // Type 1: Ring
        vec2 center = gl_PointCoord - 0.5;
        float dist = length(center);
        float ring = smoothstep(0.3, 0.35, dist) * smoothstep(0.5, 0.45, dist);
        alpha = ring * vLife;
        gl_FragColor = vec4(vColor * (1.0 + vLife * 0.5), alpha);
    } else {
        // Type 2: Square with VHS Glitch (Chromatic Aberration)
        vec2 center = gl_PointCoord - 0.5;
        
        // Helper for square alpha
        float offset = uTwinkle * 0.05; // Shift amount
        
        // Red Channel (Shifted Left)
        vec2 cR = center + vec2(offset, 0.0);
        float sqR = step(abs(cR.x), 0.4) * step(abs(cR.y), 0.4);
        float glR = 1.0 - max(abs(cR.x), abs(cR.y)) * 2.0;
        float aR = max(sqR * 0.8, pow(max(0.0, glR), 1.5) * 0.5) * vLife;

        // Green Channel (Center)
        vec2 cG = center;
        float sqG = step(abs(cG.x), 0.4) * step(abs(cG.y), 0.4);
        float glG = 1.0 - max(abs(cG.x), abs(cG.y)) * 2.0;
        float aG = max(sqG * 0.8, pow(max(0.0, glG), 1.5) * 0.5) * vLife;

        // Blue Channel (Shifted Right)
        vec2 cB = center - vec2(offset, 0.0);
        float sqB = step(abs(cB.x), 0.4) * step(abs(cB.y), 0.4);
        float glB = 1.0 - max(abs(cB.x), abs(cB.y)) * 2.0;
        float aB = max(sqB * 0.8, pow(max(0.0, glB), 1.5) * 0.5) * vLife;

        // Combine channels with additive exposure
        vec3 color = vec3(vColor.r * aR, vColor.g * aG, vColor.b * aB);
        
        // Flash white intensity
        color = mix(color, vec3(aG), uTwinkle * 0.5); // Add some white core
        color *= (1.0 + vLife * 0.5 + uTwinkle * 3.0); // Boost brightness

        gl_FragColor = vec4(color, 1.0); // Output premultiplied for Additive
    }
}
`;

// ============================================================================
// HOLOGRAM RING SHADERS
// ============================================================================

export const ringVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const ringFragmentShader = `
uniform vec3 uColor;
uniform float uLife;
uniform float uRadius;
uniform float uMaxRadius;

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;

    // Current radius normalized
    float currentRadius = uRadius / uMaxRadius;
    float ringWidth = 0.08 * (1.0 - currentRadius * 0.5);

    // Ring shape with soft edges
    float ring = smoothstep(currentRadius - ringWidth, currentRadius - ringWidth * 0.5, dist)
               * smoothstep(currentRadius + ringWidth * 0.5, currentRadius, dist);

    // Fade out as it expands
    float fade = uLife;

    gl_FragColor = vec4(uColor, ring * fade * 0.8);
}
`;

// ============================================================================
// ELECTRIC ARC SHADERS
// ============================================================================

export const arcVertexShader = `
attribute float aAlpha;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vAlpha = aAlpha;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const arcFragmentShader = `
uniform float uTime;

varying float vAlpha;
varying vec3 vColor;

void main() {
    // Flickering effect
    float flicker = 0.8 + 0.2 * sin(uTime * 20.0 + vAlpha * 10.0);

    gl_FragColor = vec4(vColor * 1.5, vAlpha * flicker);
}
`;

// ============================================================================
// POST-PROCESSING: VHS/CRT SHADER
// ============================================================================

export const VHSShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uResolution: { value: null },
        uIntensity: { value: 1.0 }
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
        uniform vec2 uResolution;
        uniform float uIntensity;

        varying vec2 vUv;

        // Pseudo-random noise
        float rand(vec2 co) {
            return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec2 uv = vUv;
            vec4 color = texture2D(tDiffuse, uv);

            // Scanlines
            float scanline = sin(uv.y * uResolution.y * 1.5) * 0.04 * uIntensity;
            color.rgb -= scanline;

            // VHS tracking bands
            float tracking = sin(uv.y * 5.0 + uTime * 0.3) * 0.01 * uIntensity;
            uv.x += tracking;
            color.rgb = mix(color.rgb, texture2D(tDiffuse, uv).rgb, 0.5);

            // Noise grain
            float noise = rand(uv + uTime * 0.01) * 0.03 * uIntensity;
            color.rgb += noise;

            // Subtle chromatic aberration
            float aberration = 0.002 * uIntensity;
            color.r = texture2D(tDiffuse, uv + vec2(aberration, 0.0)).r;
            color.b = texture2D(tDiffuse, uv - vec2(aberration, 0.0)).b;

            gl_FragColor = color;
        }
    `
};

// ============================================================================
// POST-PROCESSING: VIGNETTE SHADER
// ============================================================================

export const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        uDarkness: { value: 0.5 },
        uOffset: { value: 1.0 }
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
    `
};
