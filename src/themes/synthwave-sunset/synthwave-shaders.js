/**
 * Synthwave Sunset Theme - GLSL Shaders for Three.js
 * 
 * Contains all vertex and fragment shaders for:
 * - Infinite perspective grid with glow
 * - Volumetric sun with stripes
 * - Stars and atmosphere
 * - Tetromino cell highlights
 * - Combo particle effects
 */

// ============================================================================
// GRID SHADERS
// ============================================================================

export const gridVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const gridFragmentShader = `
uniform float time;
uniform float speed;
uniform vec3 gridColor;
uniform float glowIntensity;
uniform float pulseIntensity;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    // Grid line calculation with scrolling
    float gridSpacing = 1.5;  // Larger grid cells
    float lineWidth = 0.04;   // Slightly thicker lines to match
    
    // Scroll Z coordinate
    float scrolledZ = vWorldPos.z + time * speed;
    
    // Calculate distance to nearest grid line
    float gridX = abs(fract(vWorldPos.x / gridSpacing + 0.5) - 0.5) * gridSpacing;
    float gridZ = abs(fract(scrolledZ / gridSpacing + 0.5) - 0.5) * gridSpacing;
    
    // Create grid lines with glow falloff
    float lineX = smoothstep(lineWidth * 2.0, 0.0, gridX);
    float lineZ = smoothstep(lineWidth * 2.0, 0.0, gridZ);
    float gridLine = max(lineX, lineZ);
    
    // Distance fade (horizon falloff)
    float dist = length(vWorldPos.xz);
    float distanceFade = 1.0 - smoothstep(5.0, 60.0, dist);
    
    // Perspective fade (further = dimmer)
    float perspectiveFade = 1.0 - smoothstep(0.0, 80.0, -vWorldPos.z);
    
    // Combine
    float intensity = gridLine * glowIntensity * distanceFade * perspectiveFade;
    intensity += intensity * pulseIntensity * 0.5;
    
    // Add subtle glow around lines
    float glow = max(lineX, lineZ) * 0.3;
    
    vec3 color = gridColor * (intensity + glow * 0.5);
    float alpha = intensity * 0.9 + glow * 0.3;
    
    gl_FragColor = vec4(color, alpha * distanceFade);
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
uniform float time;
uniform vec3 colorTop;
uniform vec3 colorMid;
uniform vec3 colorBottom;
uniform float stripeCount;
uniform float pulseIntensity;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vViewDir;

// Simplex noise function
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

void main() {
    // Smooth vertical gradient - NO stripes, just beautiful color blend
    float y = vUv.y;
    vec3 baseColor;
    if (y < 0.5) {
        baseColor = mix(colorBottom, colorMid, y * 2.0);
    } else {
        baseColor = mix(colorMid, colorTop, (y - 0.5) * 2.0);
    }
    
    // Add subtle noise for solar activity (very subtle)
    float noise = snoise(vUv * 5.0 + time * 0.05) * 0.03;
    
    // Fresnel for soft edge
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.0);
    
    // Combine - smooth gradient only
    vec3 finalColor = baseColor + noise;
    finalColor += finalColor * pulseIntensity * 0.5;
    
    // Soft edge falloff
    float edgeFade = 1.0 - fresnel * 0.4;
    
    gl_FragColor = vec4(finalColor, edgeFade);
}
`;

// ============================================================================
// SUN GLOW SHADERS (for sprites)
// ============================================================================

export const sunGlowVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const sunGlowFragmentShader = `
uniform vec3 glowColor;
uniform float opacity;
uniform float pulseIntensity;

varying vec2 vUv;

void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center) * 2.0;
    
    // Radial gradient with soft falloff
    float glow = 1.0 - smoothstep(0.0, 1.0, dist);
    glow = pow(glow, 2.0);
    
    // Pulse effect
    glow += glow * pulseIntensity * 0.3;
    
    gl_FragColor = vec4(glowColor, glow * opacity);
}
`;

// ============================================================================
// STAR SHADERS
// ============================================================================

export const starVertexShader = `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;

uniform float time;

varying float vPhase;
varying vec3 vColor;

void main() {
    vPhase = aPhase;
    vColor = aColor;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    
    // Twinkle effect - vary size
    float twinkle = sin(time * 2.0 + aPhase * 6.28) * 0.5 + 0.5;
    float size = aSize * (0.7 + twinkle * 0.6);
    
    gl_PointSize = size * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const starFragmentShader = `
varying float vPhase;
varying vec3 vColor;

uniform float time;

void main() {
    // Circular point
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    // Soft glow falloff
    float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
    alpha = pow(alpha, 1.5);
    
    // Twinkle opacity
    float twinkle = sin(time * 1.5 + vPhase * 6.28) * 0.3 + 0.7;
    
    gl_FragColor = vec4(vColor, alpha * twinkle);
}
`;

// ============================================================================
// HIGHLIGHT CELL SHADERS (for tetromino grid highlighting)
// ============================================================================

export const highlightVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const highlightFragmentShader = `
uniform vec3 color;
uniform float intensity;
uniform float time;

varying vec2 vUv;

void main() {
    // Edge glow effect
    vec2 center = vUv - 0.5;
    float edge = max(abs(center.x), abs(center.y));
    float edgeGlow = smoothstep(0.35, 0.5, edge);
    
    // Inner fill
    float fill = 1.0 - smoothstep(0.0, 0.4, edge);
    
    // Combine with chromatic edge
    vec3 chromatic = color;
    chromatic.r += edgeGlow * 0.3;
    chromatic.b += edgeGlow * 0.2;
    
    // Pulse animation
    float pulse = sin(time * 3.0) * 0.1 + 1.0;
    
    vec3 finalColor = chromatic * intensity * pulse;
    float alpha = (fill * 0.6 + edgeGlow * 0.8) * intensity;
    
    gl_FragColor = vec4(finalColor, alpha);
}
`;

// ============================================================================
// PARTICLE SHADERS (for effects)
// ============================================================================

export const particleVertexShader = `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;

varying float vLife;
varying vec3 vColor;

void main() {
    vLife = aLife;
    vColor = aColor;
    
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * aLife * (200.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
}
`;

export const particleFragmentShader = `
varying float vLife;
varying vec3 vColor;

void main() {
    vec2 center = gl_PointCoord - 0.5;
    float dist = length(center);
    
    if (dist > 0.5) discard;
    
    float alpha = (1.0 - dist * 2.0) * vLife;
    alpha = pow(alpha, 1.5);
    
    gl_FragColor = vec4(vColor * (1.0 + vLife * 0.5), alpha);
}
`;

// ============================================================================
// SKY GRADIENT SHADER
// ============================================================================

export const skyVertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const skyFragmentShader = `
uniform vec3 colorTop;
uniform vec3 colorMid;
uniform vec3 colorBottom;
uniform float time;

varying vec2 vUv;

void main() {
    float y = vUv.y;
    
    // Three-color gradient
    vec3 color;
    if (y < 0.4) {
        color = mix(colorBottom, colorMid, y / 0.4);
    } else {
        color = mix(colorMid, colorTop, (y - 0.4) / 0.6);
    }
    
    // Subtle breathing animation
    float breath = sin(time * 0.2) * 0.02;
    color += breath;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

// ============================================================================
// BUILDING EDGE GLOW SHADER
// ============================================================================

export const buildingEdgeVertexShader = `
void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const buildingEdgeFragmentShader = `
uniform vec3 edgeColor;
uniform float glowIntensity;

void main() {
    gl_FragColor = vec4(edgeColor * glowIntensity, glowIntensity);
}
`;
