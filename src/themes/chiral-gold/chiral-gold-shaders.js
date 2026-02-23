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
    float angle = uTime * (0.03 + aTwinkle * 0.12);
    float s = sin(angle);
    float c = cos(angle);

    vec3 rotated = vec3(
        pos.x * c - pos.z * s,
        pos.y + sin(uTime * 0.55 + aTwinkle * 12.0) * 24.0,
        pos.x * s + pos.z * c
    );

    vec4 mvPosition = modelViewMatrix * vec4(rotated, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    gl_PointSize = aSize * (220.0 / max(1.0, -mvPosition.z)) * (1.0 + uPulse * 0.4);

    vAlpha = aAlpha * (0.58 + 0.42 * sin(uTime * 1.6 + aTwinkle * 8.0));
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
varying float vLife;
varying vec3 vColor;

void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float lifeScale = clamp(aLife, 0.0, 1.0);
    gl_PointSize = aSize * (260.0 / max(1.0, -mvPosition.z)) * (0.5 + lifeScale * 1.2);

    vLife = lifeScale;
    vec3 heated = mix(aColor, vec3(1.0, 0.98, 0.94), clamp(uColorTemperature * 0.9, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0), pow(lifeScale, 0.35));
}
`;

export const burstSparkFragmentShader = `
varying float vLife;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord * 2.0 - 1.0;
    float dist = dot(coord, coord);
    if (dist > 1.0) discard;

    float core = exp(-dist * 4.2);
    float alpha = vLife * core;
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

    gl_PointSize = aSize * (220.0 / max(1.0, -mvPosition.z)) * (1.0 + uBeatPulse * 0.85 + aPulse * 0.4);

    float shimmer = 0.72 + 0.28 * sin(uTime * 1.7 + length(position.xy) * 0.01);
    vec3 heated = mix(aColor, vec3(1.0, 0.97, 0.9), clamp(uColorTemperature * 0.85, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0, 0.95, 0.84), 0.45) * shimmer;
    vAlpha = 0.25 + shimmer * 0.5 + uBeatPulse * 0.25;
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

    gl_PointSize = aSize * (230.0 / max(1.0, -mvPosition.z)) * (1.0 + uIntensity * 0.55);

    float twinkle = 0.65 + 0.35 * sin(uTime * 2.2 + aPhase * 18.0);
    vec3 heated = mix(color, vec3(1.0, 0.975, 0.92), clamp(uColorTemperature * 0.85, 0.0, 1.0));
    vColor = mix(heated, vec3(1.0, 0.95, 0.84), 0.45) * twinkle;
    vAlpha = 0.2 + twinkle * 0.45 + uIntensity * 0.2;
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
