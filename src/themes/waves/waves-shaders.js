/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ✧ WAVES SHADERS ✧
 *  GLSL shaders for the surf-barrel theme
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Shared simplex-noise / fbm block for effect shaders
// ─────────────────────────────────────────────────────────────────────────────
const noiseCommon2D = `
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 _mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 _permute(vec3 x) { return _mod289(((x*34.0)+1.0)*x); }

float snoise2(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = _mod289(i);
    vec3 p = _permute(_permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
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
`;

// ─────────────────────────────────────────────────────────────────────────────
// Vignette (post-process)
// ─────────────────────────────────────────────────────────────────────────────
export const VignetteShader = {
    uniforms: {
        tDiffuse: { value: null },
        darkness: { value: 0.5 },
        offset: { value: 1.3 },
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
            float vig = smoothstep(offset, offset - 0.8, dist);
            texel.rgb = mix(texel.rgb * (1.0 - darkness), texel.rgb, vig);
            gl_FragColor = texel;
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Water Barrel Shader (inner cylinder wall — the ocean surface)
// New uniforms: uSurgeAmplitude, uSurgeCenterZ, uFoamBoost
// ─────────────────────────────────────────────────────────────────────────────
export const WaterBarrelShader = {
    uniforms: {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color(0x001520) },
        uMidColor: { value: new THREE.Color(0x004455) },
        uSurfaceColor: { value: new THREE.Color(0x008899) },
        uCrestColor: { value: new THREE.Color(0x44ddcc) },
        uFoamColor: { value: new THREE.Color(0xddffff) },
        uWaveIntensity: { value: 1.0 },
        uWaveSpeed: { value: 0.6 },
        uGlowIntensity: { value: 0.0 },
        uCausticsIntensity: { value: 0.4 },
        uBarrelRadius: { value: 10.0 },
        uSurgeAmplitude: { value: 0.0 },
        uSurgeCenterZ: { value: 0.0 },
        uFoamBoost: { value: 0.0 },
    },
    vertexShader: `
        uniform float uTime;
        uniform float uWaveIntensity;
        uniform float uWaveSpeed;
        uniform float uBarrelRadius;
        uniform float uSurgeAmplitude;
        uniform float uSurgeCenterZ;

        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying float vElevation;
        varying float vBarrelAngle;

        vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        vec3 fade(vec3 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

        float cnoise(vec3 P) {
            vec3 Pi0 = floor(P);
            vec3 Pi1 = Pi0 + vec3(1.0);
            Pi0 = mod(Pi0, 289.0);
            Pi1 = mod(Pi1, 289.0);
            vec3 Pf0 = fract(P);
            vec3 Pf1 = Pf0 - vec3(1.0);
            vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
            vec4 iy = vec4(Pi0.yy, Pi1.yy);
            vec4 iz0 = Pi0.zzzz;
            vec4 iz1 = Pi1.zzzz;
            vec4 ixy = permute(permute(ix) + iy);
            vec4 ixy0 = permute(ixy + iz0);
            vec4 ixy1 = permute(ixy + iz1);
            vec4 gx0 = ixy0 / 7.0;
            vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5;
            gx0 = fract(gx0);
            vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
            vec4 sz0 = step(gz0, vec4(0.0));
            gx0 -= sz0 * (step(0.0, gx0) - 0.5);
            gy0 -= sz0 * (step(0.0, gy0) - 0.5);
            vec4 gx1 = ixy1 / 7.0;
            vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5;
            gx1 = fract(gx1);
            vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
            vec4 sz1 = step(gz1, vec4(0.0));
            gx1 -= sz1 * (step(0.0, gx1) - 0.5);
            gy1 -= sz1 * (step(0.0, gy1) - 0.5);
            vec3 g000 = vec3(gx0.x,gy0.x,gz0.x);
            vec3 g100 = vec3(gx0.y,gy0.y,gz0.y);
            vec3 g010 = vec3(gx0.z,gy0.z,gz0.z);
            vec3 g110 = vec3(gx0.w,gy0.w,gz0.w);
            vec3 g001 = vec3(gx1.x,gy1.x,gz1.x);
            vec3 g101 = vec3(gx1.y,gy1.y,gz1.y);
            vec3 g011 = vec3(gx1.z,gy1.z,gz1.z);
            vec3 g111 = vec3(gx1.w,gy1.w,gz1.w);
            vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
            g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
            vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
            g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
            float n000 = dot(g000, Pf0);
            float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
            float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
            float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
            float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
            float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
            float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
            float n111 = dot(g111, Pf1);
            vec3 fade_xyz = fade(Pf0);
            vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
            vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
            float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
            return 2.2 * n_xyz;
        }

        vec3 gerstnerWave(vec2 direction, float steepness, float wavelength, vec3 p, float time) {
            float k = 6.28318 / wavelength;
            float c = sqrt(9.8 / k);
            vec2 d = normalize(direction);
            float f = k * (dot(d, p.xz) - c * time);
            float a = steepness / k;
            return vec3(d.x * a * cos(f), a * sin(f), d.y * a * cos(f));
        }

        void main() {
            vUv = uv;
            vec3 pos = position;
            float time = uTime * uWaveSpeed;
            vBarrelAngle = atan(pos.y, pos.x);

            vec3 worldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
            vec3 waveOffset = vec3(0.0);

            waveOffset += gerstnerWave(vec2(1.0, 0.3), 0.25, 20.0, worldPos, time);
            waveOffset += gerstnerWave(vec2(0.7, 0.7), 0.18, 15.0, worldPos, time * 1.1);
            waveOffset += gerstnerWave(vec2(-0.4, 0.9), 0.12, 11.0, worldPos, time * 0.9);
            waveOffset += gerstnerWave(vec2(0.9, -0.2), 0.08, 8.0, worldPos, time * 0.85);
            waveOffset += gerstnerWave(vec2(0.5, 0.5), 0.05, 5.0, worldPos, time * 1.2);

            float noise = cnoise(vec3(worldPos.xz * 0.15, time * 0.3)) * 0.2;
            noise += cnoise(vec3(worldPos.xz * 0.08, time * 0.25)) * 0.15;

            float totalDisplacement = (waveOffset.y + noise) * uWaveIntensity;

            // Travelling swell — gaussian bump that rolls along the Z axis on line-clear
            float surgeDist = worldPos.z - uSurgeCenterZ;
            float surge = exp(-(surgeDist * surgeDist) / 80.0) * uSurgeAmplitude;
            totalDisplacement += surge;

            vElevation = totalDisplacement;

            pos += normal * totalDisplacement * 0.8;
            pos.x += waveOffset.x * 0.3;
            pos.z += waveOffset.z * 0.3;

            vPosition = pos;
            vNormal = normal;
            vWorldNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);

            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform vec3 uDeepColor;
        uniform vec3 uMidColor;
        uniform vec3 uSurfaceColor;
        uniform vec3 uCrestColor;
        uniform vec3 uFoamColor;
        uniform float uGlowIntensity;
        uniform float uCausticsIntensity;
        uniform float uFoamBoost;

        varying vec3 vPosition;
        varying vec3 vNormal;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        varying float vElevation;
        varying float vBarrelAngle;

        ${noiseCommon2D}

        void main() {
            float heightFactor = clamp(vElevation * 2.0 + 0.5, 0.0, 1.0);
            float depthFactor = clamp((vPosition.z + 30.0) / 60.0, 0.0, 1.0);

            vec3 color = mix(uDeepColor, uMidColor, depthFactor * 0.7);
            color = mix(color, uSurfaceColor, depthFactor);
            color = mix(color, uCrestColor, heightFactor * 0.6);

            vec3 lightDir = normalize(vec3(0.0, 0.2, 1.0));
            vec3 viewDir = normalize(cameraPosition - vPosition);

            float diffuse = max(dot(vWorldNormal, lightDir), 0.0);
            diffuse = pow(diffuse, 0.6) * 0.5 + 0.4;

            vec3 halfDir = normalize(lightDir + viewDir);
            float specular = pow(max(dot(vWorldNormal, halfDir), 0.0), 64.0);

            float fresnel = pow(1.0 - max(dot(vWorldNormal, viewDir), 0.0), 3.0);

            vec2 causticsUV = vPosition.xz * 0.3 + vPosition.y * 0.1;
            float c1 = snoise2(causticsUV + uTime * 0.25);
            float c2 = snoise2(causticsUV * 1.3 - uTime * 0.2);
            float c3 = snoise2(causticsUV * 0.8 + uTime * 0.3);
            float caustics = (c1 + c2 + c3) * 0.33;
            caustics = pow(max(caustics, 0.0), 2.5) * uCausticsIntensity * 0.5 * depthFactor;

            float foamNoise = snoise2(vPosition.xz * 1.5 + uTime * 0.15);
            float foamCrest = smoothstep(0.4, 0.7, vElevation) * (foamNoise * 0.3 + 0.5);
            // Extra foam from gameplay boost — favours the upper half of the barrel (gravity/physics)
            float topBias = clamp(vPosition.y / 10.0 + 0.5, 0.0, 1.0);
            float foam = foamCrest + uFoamBoost * (foamNoise * 0.3 + 0.5) * topBias * 0.6;

            float sss = pow(max(dot(-viewDir, lightDir), 0.0), 4.0) * 0.25;
            sss *= depthFactor;

            color *= diffuse;
            color += vec3(1.0) * specular * 0.6;
            color += uCrestColor * fresnel * 0.4;
            color += uCrestColor * caustics;
            color += uSurfaceColor * sss;
            color = mix(color, uFoamColor, clamp(foam * 0.5, 0.0, 1.0));

            color += uCrestColor * uGlowIntensity * 0.4;

            float exitGlow = pow(depthFactor, 2.5) * 0.3;
            color += vec3(0.7, 0.9, 1.0) * exitGlow;

            gl_FragColor = vec4(color, 0.94);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Spray Shader — ambient mist drifting through the tube
// New uniform: uEventBoost
// ─────────────────────────────────────────────────────────────────────────────
export const SprayShader = {
    uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffffff) },
        uEventBoost: { value: 0.0 },
    },
    vertexShader: `
        attribute float aSize;
        attribute float aPhase;
        attribute float aSpeed;
        uniform float uTime;
        uniform float uEventBoost;
        varying float vAlpha;

        void main() {
            vec3 pos = position;
            float speedMul = 1.0 + uEventBoost * 2.0;
            float t = uTime * aSpeed * speedMul + aPhase;

            pos.z += t * 2.0;
            pos.x += sin(t * 2.0 + aPhase) * (0.3 + uEventBoost * 0.8);
            pos.y += cos(t * 1.5 + aPhase) * (0.2 + uEventBoost * 0.6);

            pos.z = mod(pos.z + 40.0, 80.0) - 40.0;

            vAlpha = 0.3 + 0.2 * sin(t * 3.0) + uEventBoost * 0.35;

            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;
            gl_PointSize = aSize * (80.0 / -mvPos.z) * (1.0 + uEventBoost * 0.6);
            gl_PointSize = clamp(gl_PointSize, 1.0, 18.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
            float dist = length(gl_PointCoord - 0.5) * 2.0;
            if(dist > 1.0) discard;
            float alpha = (1.0 - dist * dist) * vAlpha;
            gl_FragColor = vec4(uColor, alpha * 0.4);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Exit Glow Shader — the sun at the barrel mouth
// New uniform: uSurge (0..1) pulls inner colour toward pure white
// ─────────────────────────────────────────────────────────────────────────────
export const ExitGlowShader = {
    uniforms: {
        uInnerColor: { value: new THREE.Color(0xffffff) },
        uOuterColor: { value: new THREE.Color(0x66ddff) },
        uSurge: { value: 0.0 },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uInnerColor;
        uniform vec3 uOuterColor;
        uniform float uSurge;
        varying vec2 vUv;
        void main() {
            float dist = length(vUv - 0.5) * 2.0;
            vec3 color = mix(uInnerColor, uOuterColor, dist);
            color += vec3(1.0) * uSurge * (1.0 - dist) * 0.8;
            float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
            alpha *= (0.85 + uSurge * 0.4);
            gl_FragColor = vec4(color, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Ripple Ring Shader — expanding concentric-foam disc tangent to the barrel wall
// Uniforms per-instance: uAge (0..1), uStrength
// ─────────────────────────────────────────────────────────────────────────────
export const RippleRingShader = {
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uAge;
        uniform float uStrength;
        uniform vec3 uInnerColor;
        uniform vec3 uOuterColor;
        varying vec2 vUv;

        ${noiseCommon2D}

        void main() {
            vec2 uv = vUv - 0.5;
            float r = length(uv) * 2.0;
            if (r > 1.0) discard;

            // Expanding ring — crest position moves outward with age
            float crest = uAge;
            float ringWidth = 0.18 + uAge * 0.15;
            float ring = smoothstep(crest - ringWidth, crest, r) * smoothstep(crest + ringWidth * 0.6, crest, r);

            // Secondary trailing rings for foamy texture
            float ring2 = smoothstep(crest - 0.08, crest - 0.02, r) * smoothstep(crest, crest - 0.08, r) * 0.5;

            // Foam noise
            float noise = snoise2(uv * 20.0 + uAge * 3.0) * 0.5 + 0.5;
            float foam = ring * (0.6 + noise * 0.4) + ring2 * 0.5;

            vec3 color = mix(uInnerColor, uOuterColor, r);
            float fade = (1.0 - uAge) * uStrength;
            float alpha = foam * fade;

            gl_FragColor = vec4(color, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Droplet Burst Shader — GPU-simulated splash particles
// Per-particle attrs: aVelocity, aRandom, aSeed
// Uniforms: uAge (0..1 lifetime), uStrength, uGravity (direction)
// ─────────────────────────────────────────────────────────────────────────────
export const DropletBurstShader = {
    vertexShader: `
        attribute vec3 aVelocity;
        attribute float aRandom;
        uniform float uAge;
        uniform float uStrength;
        uniform vec3 uGravity;
        uniform float uSize;
        varying float vAlpha;

        void main() {
            // Ballistic: x = v*t + 0.5*g*t^2, using uAge as t in [0,1]
            float t = uAge;
            vec3 offset = aVelocity * t + uGravity * (t * t * 0.5);
            // Slight drag so particles decelerate as they fly
            offset *= (1.0 - t * 0.25);

            vec3 pos = position + offset;

            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;

            // Size tapers as age increases
            float sizeMul = mix(1.0, 0.35, t);
            float baseSize = uSize * (0.5 + aRandom * 0.9);
            gl_PointSize = baseSize * sizeMul * (80.0 / -mvPos.z);
            gl_PointSize = clamp(gl_PointSize, 1.0, 24.0);

            // Alpha bursts up then fades
            float alphaUp = smoothstep(0.0, 0.08, t);
            float alphaDown = 1.0 - smoothstep(0.4, 1.0, t);
            vAlpha = alphaUp * alphaDown * uStrength;
        }
    `,
    fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
            float dist = length(gl_PointCoord - 0.5) * 2.0;
            if (dist > 1.0) discard;
            float soft = 1.0 - dist * dist;
            float core = 1.0 - smoothstep(0.0, 0.35, dist);
            vec3 col = uColor + vec3(core * 0.4);
            gl_FragColor = vec4(col, soft * vAlpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Bubble Stream Shader — tiny rising air bubbles
// Per-particle: aSeed (0..1 staggered life phase)
// Uniforms: uAge (0..1), uOrigin (vec3)
// ─────────────────────────────────────────────────────────────────────────────
export const BubbleStreamShader = {
    vertexShader: `
        attribute float aSeed;
        attribute vec3 aDrift;
        uniform float uAge;
        uniform float uStrength;
        uniform vec3 uOrigin;
        varying float vAlpha;

        void main() {
            // Each bubble has its own phase within the lifetime
            float phase = fract(uAge + aSeed);
            // Bubbles rise along -normal direction (supplied via aDrift: inward from wall)
            vec3 pos = uOrigin + aDrift * phase * 4.0;
            pos.y += phase * 3.0; // buoyancy
            pos.x += sin(phase * 6.28 + aSeed * 10.0) * 0.25;

            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;

            float size = (2.0 + aSeed * 3.5) * (60.0 / -mvPos.z);
            gl_PointSize = clamp(size, 1.0, 10.0);

            float appear = smoothstep(0.0, 0.2, phase);
            float disappear = 1.0 - smoothstep(0.75, 1.0, phase);
            vAlpha = appear * disappear * uStrength;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float dist = length(uv) * 2.0;
            if (dist > 1.0) discard;
            // Hollow bubble look
            float rim = smoothstep(0.85, 1.0, dist) * 1.2;
            float inner = 1.0 - smoothstep(0.0, 0.7, dist);
            float mask = rim + inner * 0.3;
            gl_FragColor = vec4(vec3(0.8, 0.95, 1.0), mask * vAlpha * 0.75);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// God-Ray Shader — long narrow planes anchored at the exit, fading over length
// Uniforms: uAge (0..1), uStrength, uTime
// ─────────────────────────────────────────────────────────────────────────────
export const GodRayShader = {
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uAge;
        uniform float uStrength;
        uniform float uTime;
        uniform vec3 uWarmColor;
        uniform vec3 uCoolColor;
        varying vec2 vUv;

        ${noiseCommon2D}

        void main() {
            // UV.x = across the beam (0..1, centre at 0.5)
            // UV.y = along the beam (0 = anchor at exit, 1 = tip into barrel)
            float widthMask = 1.0 - pow(abs(vUv.x - 0.5) * 2.0, 1.5);
            widthMask = clamp(widthMask, 0.0, 1.0);

            float noiseMod = snoise2(vec2(vUv.y * 4.0, uTime * 0.6)) * 0.15 + 0.85;
            widthMask *= noiseMod;

            // Length fade — bright near anchor, fades toward tip
            float lengthFade = 1.0 - smoothstep(0.0, 1.0, vUv.y);
            lengthFade = pow(lengthFade, 1.2);

            // Lifetime curve — ease in then out
            float life = sin(uAge * 3.14159);
            life = pow(life, 0.8);

            vec3 color = mix(uWarmColor, uCoolColor, vUv.y);
            float alpha = widthMask * lengthFade * life * uStrength;

            gl_FragColor = vec4(color, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Plankton Streak Shader — elongated bioluminescent trails chasing the curl
// Per-particle: aAngleStart, aAngleSpeed, aZ, aRadius, aSeed
// Uniforms: uAge (0..1), uStrength
// ─────────────────────────────────────────────────────────────────────────────
export const PlanktonStreakShader = {
    vertexShader: `
        attribute float aAngleStart;
        attribute float aAngleSpeed;
        attribute float aZ;
        attribute float aRadius;
        attribute float aSeed;
        uniform float uAge;
        uniform float uStrength;
        varying float vAlpha;

        void main() {
            float angle = aAngleStart + aAngleSpeed * uAge * 3.14159;
            float zDrift = uAge * 20.0 * (0.4 + aSeed * 0.6);
            float r = aRadius * (1.0 + sin(uAge * 3.14 + aSeed * 6.28) * 0.03);

            vec3 pos = vec3(cos(angle) * r, sin(angle) * r, aZ + zDrift);

            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;

            // Stretched size — elongated via point size + fragment trail
            float baseSize = (6.0 + aSeed * 10.0);
            gl_PointSize = baseSize * (100.0 / -mvPos.z);
            gl_PointSize = clamp(gl_PointSize, 3.0, 28.0);

            float appear = smoothstep(0.0, 0.12, uAge);
            float disappear = 1.0 - smoothstep(0.7, 1.0, uAge);
            vAlpha = appear * disappear * uStrength;
        }
    `,
    fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;

        void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float dist = length(uv) * 2.0;
            if (dist > 1.0) discard;
            float core = 1.0 - smoothstep(0.0, 0.3, dist);
            float halo = 1.0 - smoothstep(0.0, 1.0, dist);
            vec3 col = uColor + vec3(core * 0.6);
            float alpha = (core + halo * 0.5) * vAlpha;
            gl_FragColor = vec4(col, alpha);
        }
    `,
};

// ─────────────────────────────────────────────────────────────────────────────
// Foam Curtain Shader — cascading whitewater from the top arc of the barrel
// Per-particle: aAngle, aZ, aSeed, aSpeed
// Uniforms: uAge (0..1), uStrength
// ─────────────────────────────────────────────────────────────────────────────
export const FoamCurtainShader = {
    vertexShader: `
        attribute float aAngle;
        attribute float aZ;
        attribute float aSeed;
        attribute float aSpeed;
        uniform float uAge;
        uniform float uStrength;
        uniform float uBarrelRadius;
        varying float vAlpha;
        varying float vSeed;

        void main() {
            float t = uAge * aSpeed;
            // Angle drifts toward straight-down (angle = -PI/2) under "gravity"
            float targetAngle = -1.5707963;
            float angle = mix(aAngle, targetAngle, clamp(t * 0.9, 0.0, 0.9));

            // Radius shrinks as foam falls inward
            float r = uBarrelRadius * (1.0 - t * 0.15);
            // Vertical drop beyond the wall
            float yDrop = -t * t * 6.0;

            float zDrift = aZ + t * 4.0 * (0.5 + aSeed);
            float lateral = sin(aSeed * 10.0 + t * 2.0) * 0.3;

            vec3 pos = vec3(
                cos(angle) * r + lateral,
                sin(angle) * r + yDrop,
                zDrift
            );

            vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
            gl_Position = projectionMatrix * mvPos;

            float size = (3.0 + aSeed * 9.0);
            gl_PointSize = size * (80.0 / -mvPos.z);
            gl_PointSize = clamp(gl_PointSize, 1.0, 24.0);

            float appear = smoothstep(0.0, 0.1, uAge);
            float disappear = 1.0 - smoothstep(0.7, 1.0, uAge);
            vAlpha = appear * disappear * uStrength;
            vSeed = aSeed;
        }
    `,
    fragmentShader: `
        varying float vAlpha;
        varying float vSeed;

        void main() {
            vec2 uv = gl_PointCoord - 0.5;
            float dist = length(uv) * 2.0;
            if (dist > 1.0) discard;
            float soft = 1.0 - dist * dist;
            // Tint — warm core → cyan → white
            vec3 col = mix(vec3(1.0), vec3(0.8, 1.0, 1.0), vSeed);
            gl_FragColor = vec4(col, soft * vAlpha * 0.85);
        }
    `,
};
