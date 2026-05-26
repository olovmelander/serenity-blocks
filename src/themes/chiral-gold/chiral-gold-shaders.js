/**
 * Chiral Gold - WebGL fallback shaders
 */

export const goldDustVertexShader = `
uniform float uTime;
uniform float uPulse;
attribute float aTwinkle;
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec3 pos = position;
    
    // Toroidal vortex flow math in GLSL
    float radXZ = length(pos.xz) + 0.001;
    float dirX = pos.x / radXZ;
    float dirZ = pos.z / radXZ;
    
    // Tangent orbit direction
    float tangX = -dirZ;
    float tangZ = dirX;
    
    // Target radius breathes over time
    float targetRadius = 3000.0 + sin(uTime * 0.12) * 450.0;
    float radialDelta = radXZ - targetRadius;
    float pullStrength = radialDelta * 0.09;
    
    // Speed baseline
    float spiralSpeed = (aTwinkle * 0.08 + 0.02) * (420.0 + uPulse * 200.0);
    
    // Spiral position update
    float angle = spiralSpeed * uTime * 0.002;
    float s = sin(angle);
    float c = cos(angle);
    vec3 rotated = vec3(
        pos.x * c - pos.z * s - dirX * pullStrength * 0.2,
        pos.y + sin(uTime * 0.55 + aTwinkle * 12.0) * 80.0,
        pos.x * s + pos.z * c - dirZ * pullStrength * 0.2
    );
    
    // Simplex / Curl noise approximation
    float f1 = 0.0015;
    float f2 = 0.0042;
    float nt = uTime * 0.08;
    float cx1 = sin(rotated.y * f1 + nt) - cos(rotated.z * f1 - nt * 0.75);
    float cy1 = sin(rotated.z * f1 + nt * 1.15) - cos(rotated.x * f1 + nt * 0.55);
    float cz1 = sin(rotated.x * f1 - nt * 0.95) - cos(rotated.y * f1 - nt * 0.45);
    
    float cx2 = sin(rotated.y * f2 - nt * 1.85) + cos(rotated.z * f2 + nt * 1.25);
    float cy2 = sin(rotated.z * f2 + nt * 1.55) + cos(rotated.x * f2 - nt * 1.65);
    float cz2 = sin(rotated.x * f2 - nt * 1.15) + cos(rotated.y * f2 + nt * 1.45);
    
    vec3 noise = vec3(cx1, cy1, cz1) + vec3(cx2, cy2, cz2) * 0.38;
    vec3 flowVec = normalize(noise + 0.0001);
    float flowAmp = mix(140.0, 420.0, clamp(uPulse * 1.5, 0.0, 1.0));
    
    vec3 finalPos = rotated + flowVec * flowAmp;

    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    float boardDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    float focalDist = abs(-mvPosition.z - boardDepth);
    float focalRange = 340.0;
    float blurFactor = clamp((focalDist - focalRange) / 650.0, 0.0, 3.2);
    float sizeScale = 1.0 + blurFactor * 1.25;
    float opacityScale = 1.0 / (1.0 + blurFactor * 2.5);

    gl_PointSize = aSize * sizeScale * (200.0 / max(1.0, -mvPosition.z)) * (1.0 + uPulse * 0.45);

    vAlpha = 0.52 * aAlpha * (0.58 + 0.42 * sin(uTime * 1.6 + aTwinkle * 8.0)) * opacityScale;
    vColor = color;
}
`;

export const goldDustFragmentShader = `
uniform float uColorTemperature;
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(coord, coord);
    if (dist > 1.0) discard;

    float softness = exp(-dist * 2.8);
    vec3 heated = mix(vColor, vec3(1.0, 0.985, 0.95), clamp(uColorTemperature * 0.85, 0.0, 1.0));
    gl_FragColor = vec4(heated * 2.2, vAlpha * softness);
}
`;

export const burstSparkVertexShader = `
uniform float uTime;
uniform float uColorTemperature;
attribute float aLife;
attribute float aSize;
attribute vec3 aColor;
attribute vec3 aVelocity;
varying float vLife;
varying vec3 vColor;
varying vec2 vVelDir;
varying float vVelMag;
varying float vOpacityScale;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float lifeScale = clamp(aLife, 0.0, 1.0);
    
    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    float boardDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    float focalDist = abs(-mvPosition.z - boardDepth);
    float focalRange = 340.0;
    float blurFactor = clamp((focalDist - focalRange) / 650.0, 0.0, 3.2);
    float sizeScale = 1.0 + blurFactor * 1.25;
    vOpacityScale = 1.0 / (1.0 + blurFactor * 2.5);

    // Transform velocity to view space
    vec3 viewVel = (modelViewMatrix * vec4(aVelocity, 0.0)).xyz;
    vVelMag = length(viewVel.xy);
    vVelDir = vVelMag > 0.0001 ? viewVel.xy / vVelMag : vec2(1.0, 0.0);

    float sizeStretchFactor = 1.0 + vVelMag * 0.012;

    gl_PointSize = aSize * sizeScale * sizeStretchFactor * (260.0 / max(1.0, -mvPosition.z)) * (0.5 + lifeScale * 1.2);

    vLife = lifeScale;
    vec3 heated = mix(aColor, vec3(1.0, 0.98, 0.94), clamp(uColorTemperature * 0.9, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0), pow(lifeScale, 0.35));
}
`;

export const burstSparkFragmentShader = `
varying float vLife;
varying vec3 vColor;
varying vec2 vVelDir;
varying float vVelMag;
varying float vOpacityScale;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    
    // Stretch along the velocity direction
    float u = dot(coord, vVelDir);
    float v = dot(coord, vec2(-vVelDir.y, vVelDir.x));
    
    float stretchFactor = 1.0 + vVelMag * 0.016;
    float narrowFactor = 1.0 + vVelMag * 0.012;
    
    float stretchedDist = (u * u) / stretchFactor + (v * v) * narrowFactor;
    if (stretchedDist > 1.0) discard;

    float core = exp(-stretchedDist * 3.5);
    float alphaMask = smoothstep(1.0, 0.8, stretchedDist);
    float alpha = vLife * core * alphaMask * vOpacityScale;
    
    gl_FragColor = vec4(vColor * 2.8, alpha);
}
`;

export const wispVertexShader = `
uniform float uTime;
uniform float uBeatPulse;
uniform float uColorTemperature;
attribute float aSize;
attribute float aPulse;
attribute vec3 aColor;
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    float boardDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    float focalDist = abs(-mvPosition.z - boardDepth);
    float focalRange = 340.0;
    float blurFactor = clamp((focalDist - focalRange) / 650.0, 0.0, 3.2);
    float sizeScale = 1.0 + blurFactor * 1.25;
    float opacityScale = 1.0 / (1.0 + blurFactor * 2.5);

    gl_PointSize = aSize * sizeScale * (220.0 / max(1.0, -mvPosition.z)) * (1.0 + uBeatPulse * 0.85 + aPulse * 0.4);

    float shimmer = 0.72 + 0.28 * sin(uTime * 1.7 + length(position.xy) * 0.01);
    vec3 heated = mix(aColor, vec3(1.0, 0.97, 0.9), clamp(uColorTemperature * 0.85, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0, 0.95, 0.84), 0.45) * shimmer;
    vAlpha = (0.25 + shimmer * 0.5 + uBeatPulse * 0.25) * opacityScale;
}
`;

export const wispFragmentShader = `
varying vec3 vColor;
varying float vAlpha;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(coord, coord);
    if (dist > 1.0) discard;

    float softness = exp(-dist * 2.2);
    gl_FragColor = vec4(vColor * 2.0, vAlpha * softness);
}
`;

export const strandVertexShader = `
uniform float uTime;
uniform float uIntensity;
uniform float uColorTemperature;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Depth-of-Field (bokeh simulation) based on distance to the board's plane (world z=0)
    float boardDepth = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
    float focalDist = abs(-mvPosition.z - boardDepth);
    float focalRange = 340.0;
    float blurFactor = clamp((focalDist - focalRange) / 650.0, 0.0, 3.2);
    float sizeScale = 1.0 + blurFactor * 1.25;
    float opacityScale = 1.0 / (1.0 + blurFactor * 2.5);

    gl_PointSize = aSize * sizeScale * (230.0 / max(1.0, -mvPosition.z)) * (1.0 + uIntensity * 0.55);

    float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + aPhase * 18.0);
    vec3 heated = mix(color, vec3(1.0, 0.975, 0.92), clamp(uColorTemperature * 0.85, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0, 0.95, 0.84), 0.45) * twinkle;
    vAlpha = (0.2 + twinkle * 0.45 + uIntensity * 0.2) * opacityScale;
}
`;

export const strandFragmentShader = `
varying float vAlpha;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(coord, coord);
    if (dist > 1.0) discard;

    float softness = exp(-dist * 2.5);
    gl_FragColor = vec4(vColor * 2.1, vAlpha * softness);
}
`;

export const ChiralGoldChromaticShader = {
    uniforms: {
        tDiffuse: { value: null },
        uIntensity: { value: 0.003 },
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
        varying vec2 vUv;

        void main() {
            vec2 dir = vUv - vec2(0.5);
            vec2 offset = dir * uIntensity;

            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;
            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

export const ChiralGoldVignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.9 },
        offset: { value: 1.1 },
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
            float vig = smoothstep(offset, offset - 0.7, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

export const ChiralGoldFilmGrainShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uStrength: { value: 0.015 },
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
        uniform float uStrength;
        varying vec2 vUv;

        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float grain = hash(vUv + uTime * 0.01) - 0.5;
            color.rgb += grain * uStrength;
            gl_FragColor = color;
        }
    `,
};
