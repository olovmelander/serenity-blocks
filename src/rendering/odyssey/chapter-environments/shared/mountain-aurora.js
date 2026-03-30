import * as THREE from 'three';

export const MOUNTAIN_AURORA_CURTAIN_CONFIGS = Object.freeze([
    Object.freeze({
        x: 0, y: 600, z: -1500, width: 4000, height: 1500, rotY: 0, opacity: 1.0,
    }),
    Object.freeze({
        x: -500, y: 500, z: -1300, width: 2500, height: 1200, rotY: 0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 500, y: 550, z: -1350, width: 2500, height: 1200, rotY: -0.1, opacity: 0.8,
    }),
    Object.freeze({
        x: 0, y: 800, z: -2000, width: 5000, height: 1800, rotY: 0, opacity: 0.6,
    }),
]);

export const SURFACE_WORLD_AURORA_PREVIEW_LAYER_OPACITIES = Object.freeze([0.35, 0.25, 0.18]);
export const SURFACE_WORLD_AURORA_PREVIEW_START = 0.27;
export const SURFACE_WORLD_AURORA_PREVIEW_END = 0.33;

const noiseGLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
                i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

const auroraVertexShader = `
uniform float uTime;
uniform float layerOffset;

varying vec2 vUv;
varying float vDisplacement;

${noiseGLSL}

void main() {
    vUv = uv;

    float t = uTime * 0.2 + layerOffset;
    float noise1 = snoise(vec3(position.x * 0.05, position.y * 0.05, t * 0.5));
    float noise2 = snoise(vec3(position.x * 0.1, position.y * 0.1, t * 0.8)) * 0.5;

    vDisplacement = noise1 + noise2;

    vec3 transformed = position;
    transformed.z += vDisplacement * 10.0;
    transformed.x += sin(position.y * 0.05 + t) * 5.0;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

const auroraFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uOpacity;
uniform float uAuroraFade;
uniform float uLayerOpacity;

varying vec2 vUv;
varying float vDisplacement;

${noiseGLSL}

void main() {
    float alpha = smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
    float xFade = smoothstep(0.0, 0.2, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
    alpha *= xFade;

    float noiseVal = snoise(vec3(vUv.x * 2.0, vUv.y * 1.0, uTime * 0.1));
    vec3 color = mix(uColor1, uColor2, vUv.y);
    color = mix(color, uColor3, smoothstep(0.4, 0.6, noiseVal));

    float bands = sin(vUv.y * 20.0 + vDisplacement * 2.0) * 0.5 + 0.5;
    alpha *= 0.5 + bands * 0.5;
    color *= 1.1;

    gl_FragColor = vec4(color, alpha * 0.45 * uLayerOpacity * uAuroraFade * uOpacity);
}
`;

export function resolveMountainAuroraPreviewOpacity(progress) {
    if (!Number.isFinite(progress)) {
        return 0;
    }

    return THREE.MathUtils.smoothstep(
        progress,
        SURFACE_WORLD_AURORA_PREVIEW_START,
        SURFACE_WORLD_AURORA_PREVIEW_END,
    );
}

export function createMountainAuroraBackdrop(uniforms, options = {}) {
    const {
        layerCount = MOUNTAIN_AURORA_CURTAIN_CONFIGS.length,
        layerOpacities = null,
        name = 'mountain-aurora',
    } = options;

    const group = new THREE.Group();
    group.name = name;

    const selectedConfigs = MOUNTAIN_AURORA_CURTAIN_CONFIGS.slice(
        0,
        Math.min(layerCount, MOUNTAIN_AURORA_CURTAIN_CONFIGS.length),
    );
    group.userData.auroraAnchors = selectedConfigs.map((config) => ({
        x: config.x,
        y: config.y,
        z: config.z,
        rotY: config.rotY,
    }));

    selectedConfigs.forEach((config, index) => {
        const geometry = new THREE.PlaneGeometry(config.width, config.height, 64, 16);
        const layerOpacity = Number.isFinite(layerOpacities?.[index])
            ? layerOpacities[index]
            : config.opacity;

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                layerOffset: { value: index * 2.0 },
                uColor1: { value: new THREE.Color(0x00ffaa) },
                uColor2: { value: new THREE.Color(0x00aaff) },
                uColor3: { value: new THREE.Color(0xaa00ff) },
                uOpacity: { value: 1 },
                uAuroraFade: { value: 1 },
                uLayerOpacity: { value: layerOpacity },
            },
            vertexShader: auroraVertexShader,
            fragmentShader: auroraFragmentShader,
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const curtain = new THREE.Mesh(geometry, material);
        curtain.position.set(config.x, config.y, config.z);
        curtain.rotation.y = config.rotY;
        curtain.renderOrder = -50;
        group.add(curtain);
    });

    return group;
}
