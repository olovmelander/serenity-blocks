/**
 * Stellar Velocity shader source module.
 * Keeps WebGL fallback shaders centralized for Phase 0 baseline lock.
 */

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

export const ChromaticAberrationShader = {
    uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.0 },
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
        uniform float intensity;
        varying vec2 vUv;

        void main() {
            vec2 dir = vUv - 0.5;
            float dist = length(dir);
            vec2 offset = dir * dist * intensity * 0.02;

            float r = texture2D(tDiffuse, vUv + offset).r;
            float g = texture2D(tDiffuse, vUv).g;
            float b = texture2D(tDiffuse, vUv - offset).b;

            gl_FragColor = vec4(r, g, b, 1.0);
        }
    `,
};

export const STARFIELD_VERTEX_SHADER = `
    attribute float aSize;
    attribute float aVelocity;
    attribute vec2 aTwinkle;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uWarpSpeed;
    uniform float uTwinkleBoost;

    varying vec3 vColor;
    varying float vBrightness;
    varying float vTrailLength;

    void main() {
        vColor = color;

        // Gentle brightness twinkle
        float twinkle = sin(uTime * aTwinkle.y + aTwinkle.x);
        vBrightness = 0.7 + twinkle * 0.3 + uTwinkleBoost;

        // Trail length based on warp speed
        vTrailLength = uWarpSpeed * aVelocity;

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

        // Size increases slightly at high warp
        float warpSizeBoost = 1.0 + uWarpSpeed * 0.3;
        gl_PointSize = aSize * uPixelRatio * warpSizeBoost * (400.0 / -mvPosition.z);
        gl_PointSize = clamp(gl_PointSize, 2.0, 80.0);

        gl_Position = projectionMatrix * mvPosition;
    }
`;

export const STARFIELD_FRAGMENT_SHADER = `
    uniform sampler2D uTexture;
    uniform float uWarpSpeed;
    uniform vec3 uTunnelTint;

    varying vec3 vColor;
    varying float vBrightness;
    varying float vTrailLength;

    void main() {
        vec2 center = gl_PointCoord - 0.5;

        // Elongate the point into a trail when warping
        vec2 trailCenter = center;
        trailCenter.y *= 1.0 + vTrailLength * 3.0; // Stretch vertically

        float dist = length(trailCenter) * 2.0;

        // Soft circular falloff with trail
        float softCircle = 1.0 - smoothstep(0.0, 1.0, dist);

        // Brighter core
        float core = 1.0 - smoothstep(0.0, 0.3, dist);

        float tintMix = clamp(0.22 + uWarpSpeed * 0.18, 0.0, 0.65);
        vec3 tunnelTint = mix(vec3(1.0), uTunnelTint, tintMix);
        vec3 finalColor = vColor * vBrightness * (1.0 + core * 0.5) * tunnelTint;
        float alpha = softCircle * (vBrightness + 0.2);

        gl_FragColor = vec4(finalColor, alpha);
    }
`;

export const NEBULA_VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const NEBULA_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uPulse;
    uniform float uSeed;
    uniform vec2 uFlowDir;
    uniform vec2 uFlowOffset;
    uniform float uFlowSpeed;
    uniform float uWarpAmount;
    uniform float uDetailScale;
    uniform float uMorphRate;

    varying vec2 vUv;

    // Simplex noise functions
    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
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
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
            value += amplitude * snoise(p);
            p *= 2.0;
            amplitude *= 0.5;
        }
        return value;
    }

    void main() {
        vec2 uv = vUv;
        vec2 flowUv = uv * uDetailScale + uFlowOffset + uFlowDir * (uTime * uFlowSpeed);
        vec2 warpUv = vec2(
            snoise(flowUv * 1.6 + vec2(uSeed * 0.13, uTime * uMorphRate)),
            snoise(flowUv * 1.9 + vec2(uSeed * 0.21, -uTime * uMorphRate * 0.83))
        );
        vec2 domainUv = flowUv + warpUv * uWarpAmount;
        float baseNoise = fbm(domainUv + uSeed * 0.07);
        float detailNoise = fbm(domainUv * 1.85 + vec2(uSeed * 0.19, uTime * 0.06));
        float noise = baseNoise * 0.7 + detailNoise * 0.3;
        noise = noise * 0.5 + 0.5;

        // Edge fade
        float fadeX = smoothstep(0.0, 0.4, uv.x) * smoothstep(1.0, 0.6, uv.x);
        float fadeY = smoothstep(0.0, 0.4, uv.y) * smoothstep(1.0, 0.6, uv.y);
        float fade = fadeX * fadeY;

        // Color with noise variation
        vec3 color = uColor * (0.16 + noise * 1.18);
        color += color * uPulse * 0.55;

        float alpha = (0.14 + noise * 0.78) * (uOpacity + uPulse * 0.12) * fade;

        gl_FragColor = vec4(color, alpha);
    }
`;

export const WARP_CORE_VERTEX_SHADER = `
    varying vec3 vNormal;
    varying vec3 vPosition;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

export const WARP_CORE_FRAGMENT_SHADER = `
    uniform float uTime;
    uniform float uGlowIntensity;
    uniform float uPulseBoost;
    uniform vec3 uColor;
    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
        // Fresnel effect for rim glow
        vec3 viewDir = normalize(cameraPosition - vPosition);
        float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);

        // Domain-warped plasma bands for richer core motion.
        float domainWarp = sin(vPosition.x * 0.09 + uTime * 1.7) * 0.6
            + cos(vPosition.z * 0.07 - uTime * 1.3) * 0.4;
        float plasmaA = sin(vPosition.y * 0.14 + uTime * 4.2 + domainWarp);
        float plasmaB = cos(vPosition.x * 0.10 - vPosition.z * 0.09 + uTime * 2.8 + domainWarp * 0.65);
        float plasma = (plasmaA * 0.6 + plasmaB * 0.4) * 0.5 + 0.5;
        float swirl = sin(length(vPosition.xz) * 0.11 - uTime * 2.3 + domainWarp * 0.8) * 0.5 + 0.5;

        // Event-scaled pulsing energy.
        float pulseEnvelope = sin(uTime * 4.6) * 0.5 + 0.5;
        float pulse = (0.55 + uGlowIntensity * 0.45 + uPulseBoost * 0.40) * (0.65 + pulseEnvelope * 0.35);

        vec3 coreColor = uColor * (0.25 + plasma * 0.9 + swirl * 0.4) * pulse;
        vec3 rimColor = uColor * (fresnel * 1.35 + 0.2);
        vec3 color = coreColor + rimColor;

        float alpha = clamp(0.12 + plasma * 0.34 + swirl * 0.24 + fresnel * 0.45, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
    }
`;
