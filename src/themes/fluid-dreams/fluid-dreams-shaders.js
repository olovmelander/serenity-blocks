/**
 * Fluid Dreams Theme - WebGL Fallback Shaders
 *
 * Only used by the WebGL2 fallback path. The WebGPU primary path uses TSL node
 * materials defined in fluid-dreams-materials.js. Keep this file minimal — the
 * fluid look on the WebGL path comes from MeshPhysicalMaterial (transmission +
 * iridescence) on the orb meshes, not from raymarching here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Background — vibrant amethyst→violet vertical gradient (inverted sphere)
// ─────────────────────────────────────────────────────────────────────────────

export const backgroundVertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const backgroundFragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColorTop;
uniform vec3 uColorMid;
uniform vec3 uColorBottom;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
    float t = clamp(vUv.y, 0.0, 1.0);

    vec3 lower = mix(uColorBottom, uColorMid, smoothstep(0.0, 0.55, t));
    vec3 upper = mix(lower, uColorTop, smoothstep(0.55, 1.0, t));

    // Subtle drifting shimmer (cheap pseudo-noise).
    vec3 q = vWorldPos * 0.02 + vec3(0.0, uTime * 0.04, 0.0);
    float shimmer = sin(q.x * 4.0 + q.z * 2.5) * 0.5
        + sin(q.y * 3.0 - q.x * 1.7) * 0.5;
    shimmer = shimmer * 0.06;

    vec3 colour = upper + shimmer;
    gl_FragColor = vec4(colour, 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Particles — animated point cloud with per-particle phase + colour
// ─────────────────────────────────────────────────────────────────────────────

export const fallbackParticleVertexShader = /* glsl */ `
attribute vec3 aColor;
attribute float aPhase;
attribute float aSize;

uniform float uTime;
uniform float uPixelRatio;

varying vec3 vColor;
varying float vAlpha;

void main() {
    vColor = aColor;

    // Subtle drift — circular bob driven by per-particle phase.
    vec3 drift = vec3(
        sin(uTime * 0.45 + aPhase) * 0.45,
        cos(uTime * 0.5 + aPhase * 0.7) * 0.3,
        sin(uTime * 0.35 + aPhase * 1.3) * 0.45
    );
    vec3 pos = position + drift;

    vec4 viewPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * viewPos;

    float dist = max(1.0, -viewPos.z);
    gl_PointSize = aSize * uPixelRatio * 90.0 / dist;

    // Twinkle: 60% steady, 40% sinusoidal.
    float twinkle = 0.6 + 0.4 * sin(uTime * 1.6 + aPhase * 2.3);
    vAlpha = twinkle;
}
`;

export const fallbackParticleFragmentShader = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 centred = gl_PointCoord - 0.5;
    float d = length(centred);
    float disc = 1.0 - smoothstep(0.0, 0.5, d);
    float soft = pow(disc, 2.0);

    vec3 colour = vColor * (0.6 + soft * 0.6);
    gl_FragColor = vec4(colour, soft * vAlpha * 0.9);
}
`;
