/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MISTY LAKE WATER - Ghibli Spirit-Pond Mirror Reflection
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Lake-scale water mesh with mirror reflection camera + Gerstner waves +
 * caustics + moon column shimmer + Ghibli depth fog + foam at shore.
 *
 * Adapted from SunsetOceanWater (ocean-scale) for a calm misty lake:
 * - Smaller geometry (140×100 instead of ocean), higher per-meter tessellation
 * - 4-octave Gerstner waves for cleaner displacement than additive sines
 * - Single moon (no sun); strong vertical moon-column reflection
 * - Shore foam for that Princess Mononoke pond-edge feel
 * - Lower distortion than ocean (calmer surface)
 *
 * Mirror camera + WebGLRenderTarget pattern works on WebGL2 AND WebGPU because
 * WebGLRenderTarget textures are sample-able from both backends.
 *
 * Original Three.js Water.js MIT License — Copyright © 2010-2025 three.js authors
 */

import {
    Color,
    DoubleSide,
    LinearFilter,
    Matrix4,
    Mesh,
    PerspectiveCamera,
    Plane,
    RGBAFormat,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
    UnsignedByteType,
    Vector3,
    Vector4,
    WebGLRenderTarget,
} from 'three';

// Self-contained noise (snoise + voronoi) so water.js has no shader-module dep.
const noiseCommon = /* glsl */`
vec3 mod289_w(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_w(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute_w(vec4 x) { return mod289_w(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt_w(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
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
    i = mod289_w(i);
    vec4 p = permute_w(permute_w(permute_w(
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
    vec4 norm = taylorInvSqrt_w(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec2 voronoi(vec2 x) {
    vec2 p = floor(x);
    vec2 f = fract(x);
    float res = 8.0;
    vec2 mr;
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 b = vec2(float(i), float(j));
            vec2 r = b - f + fract(sin(vec2(dot(p + b, vec2(127.1, 311.7)), dot(p + b, vec2(269.5, 183.3)))) * 43758.5453);
            float d = dot(r, r);
            if (d < res) {
                res = d;
                mr = r;
            }
        }
    }
    return mr;
}
`;

class MistyLakeWater extends Mesh {
    constructor(geometry, options = {}) {
        super(geometry);

        this.isMistyLakeWater = true;

        const scope = this;

        const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 384;
        const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 384;
        const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
        const alpha = options.alpha !== undefined ? options.alpha : 0.97;
        const time = options.time !== undefined ? options.time : 0.0;
        const normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
        const moonDirection = options.moonDirection !== undefined ? options.moonDirection : new Vector3(0.4, 0.7, -0.6).normalize();
        const moonColor = new Color(options.moonColor !== undefined ? options.moonColor : 0xe8edff);
        const deepColor = new Color(options.deepColor !== undefined ? options.deepColor : 0x040810);
        const shallowColor = new Color(options.shallowColor !== undefined ? options.shallowColor : 0x102540);
        const eye = options.eye !== undefined ? options.eye : new Vector3(0, 0, 0);
        const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 1.4;
        const reflectionStrength = options.reflectionStrength !== undefined ? options.reflectionStrength : 0.0;
        const side = options.side !== undefined ? options.side : DoubleSide;
        const fog = options.fog !== undefined ? options.fog : false;

        const mirrorPlane = new Plane();
        const normal = new Vector3();
        const mirrorWorldPosition = new Vector3();
        const cameraWorldPosition = new Vector3();
        const rotationMatrix = new Matrix4();
        const lookAtPosition = new Vector3(0, 0, -1);
        const clipPlane = new Vector4();
        const view = new Vector3();
        const target = new Vector3();
        const q = new Vector4();
        const textureMatrix = new Matrix4();
        const mirrorCamera = new PerspectiveCamera();

        const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight, {
            format: RGBAFormat,
            // Reflections do not need HDR precision. UnsignedByteType avoids
            // driver-specific half-float framebuffer failures that can poison
            // the following composer frame with black output.
            type: UnsignedByteType,
            minFilter: LinearFilter,
            magFilter: LinearFilter,
            depthBuffer: true,
            stencilBuffer: false,
        });
        renderTarget.texture.name = 'MistyLakeMirror';

        this.renderTarget = renderTarget;
        this.mirrorCamera = mirrorCamera;

        const lakeShader = {
            name: 'MistyLakeWaterShader',

            uniforms: UniformsUtils.merge([
                UniformsLib.fog,
                {
                    uTime: { value: 0.0 },
                    uMirrorSampler: { value: null },
                    uNormalSampler: { value: null },
                    uTextureMatrix: { value: new Matrix4() },
                    uEye: { value: new Vector3() },

                    uAlpha: { value: 0.97 },
                    uDistortionScale: { value: 1.4 },
                    uReflectionStrength: { value: 0.0 },

                    uDeepColor: { value: new Color(0x040810) },
                    uShallowColor: { value: new Color(0x102540) },
                    uMoonColor: { value: new Color(0xe8edff) },
                    uMoonDirection: { value: new Vector3(0.4, 0.7, -0.6) },
                    uMoonPosition: { value: new Vector3(8, 18, -75) },

                    uMoonGlow: { value: 1.2 },
                    uGlowIntensity: { value: 0.0 },

                    uMistColor: { value: new Color(0x405070) },
                    uFogDensity: { value: 0.012 },
                },
            ]),

            vertexShader: /* glsl */`
                uniform float uTime;
                uniform mat4 uTextureMatrix;

                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec4 vMirrorCoord;
                varying float vElevation;

                #include <common>
                #include <fog_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                // 4-octave Gerstner wave summation — produces realistic open-water
                // surface motion. Each wave is parameterized by direction, amplitude,
                // wavelength, speed, and steepness. Returns displacement and partial
                // derivatives for analytical normal computation.
                vec3 gerstnerWave(
                    vec2 pos,
                    float t,
                    vec2 direction,
                    float amplitude,
                    float wavelength,
                    float speed,
                    float steepness,
                    inout vec3 tangent,
                    inout vec3 binormal
                ) {
                    float k = 6.28318530718 / wavelength;
                    float c = sqrt(9.8 / k) * speed;
                    vec2 d = normalize(direction);
                    float f = k * (dot(d, pos) - c * t);
                    float a = steepness / k;

                    tangent += vec3(
                        -d.x * d.x * (steepness * sin(f)),
                        d.x * (steepness * cos(f)),
                        -d.x * d.y * (steepness * sin(f))
                    );
                    binormal += vec3(
                        -d.x * d.y * (steepness * sin(f)),
                        d.y * (steepness * cos(f)),
                        -d.y * d.y * (steepness * sin(f))
                    );

                    return vec3(
                        d.x * (a * cos(f)),
                        amplitude * sin(f),
                        d.y * (a * cos(f))
                    );
                }

                void main() {
                    vUv = uv;

                    vec3 pos = position;
                    vec2 worldXZ = (modelMatrix * vec4(pos, 1.0)).xz;

                    // Tangent/binormal accumulators for analytical normal
                    vec3 tangent = vec3(1.0, 0.0, 0.0);
                    vec3 binormal = vec3(0.0, 0.0, 1.0);

                    vec3 disp = vec3(0.0);
                    // 4 Gerstner octaves — calmer than ocean (lower steepness)
                    disp += gerstnerWave(worldXZ, uTime, vec2(1.0, 0.4), 0.18, 14.0, 0.55, 0.35, tangent, binormal);
                    disp += gerstnerWave(worldXZ, uTime, vec2(-0.7, 0.8), 0.12, 9.0, 0.65, 0.32, tangent, binormal);
                    disp += gerstnerWave(worldXZ, uTime, vec2(0.5, -0.9), 0.07, 5.5, 0.85, 0.28, tangent, binormal);
                    disp += gerstnerWave(worldXZ, uTime, vec2(-0.4, -0.3), 0.04, 3.0, 1.1, 0.22, tangent, binormal);

                    pos += disp;
                    vElevation = disp.y;

                    vec3 worldNormal = normalize(cross(binormal, tangent));
                    vNormal = worldNormal;

                    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
                    vWorldPos = worldPos.xyz;

                    // Mirror UV from oblique-clipped camera
                    vMirrorCoord = uTextureMatrix * worldPos;

                    vec4 mvPosition = viewMatrix * worldPos;
                    gl_Position = projectionMatrix * mvPosition;

                    #include <logdepthbuf_vertex>
                    #include <fog_vertex>
                }
            `,

            fragmentShader: /* glsl */`
                uniform float uTime;
                uniform sampler2D uMirrorSampler;
                uniform sampler2D uNormalSampler;
                uniform vec3 uEye;
                uniform float uAlpha;
                uniform float uDistortionScale;
                uniform float uReflectionStrength;

                uniform vec3 uDeepColor;
                uniform vec3 uShallowColor;
                uniform vec3 uMoonColor;
                uniform vec3 uMoonDirection;
                uniform vec3 uMoonPosition;

                uniform float uMoonGlow;
                uniform float uGlowIntensity;

                uniform vec3 uMistColor;
                uniform float uFogDensity;

                varying vec2 vUv;
                varying vec3 vWorldPos;
                varying vec3 vNormal;
                varying vec4 vMirrorCoord;
                varying float vElevation;

                ${noiseCommon}

                #include <common>
                #include <packing>
                #include <fog_pars_fragment>
                #include <logdepthbuf_pars_fragment>

                vec4 sampleNormal(vec2 uv) {
                    vec2 uv0 = (uv / 18.0) + vec2(uTime / 60.0, uTime / 75.0);
                    vec2 uv1 = (uv / 12.0) - vec2(uTime / 70.0, uTime / 80.0);
                    vec2 uv2 = (uv / 26.0) + vec2(uTime / 95.0, -uTime / 85.0);

                    vec4 noise = texture2D(uNormalSampler, uv0) +
                                 texture2D(uNormalSampler, uv1) +
                                 texture2D(uNormalSampler, uv2) * 0.5;

                    return noise * 0.22 - 0.32;
                }

                void main() {
                    #include <logdepthbuf_fragment>

                    vec4 noise = sampleNormal(vWorldPos.xz);
                    vec3 normalSampled = noise.xzy * vec3(0.5, 1.0, 0.5);
                    vec3 surfaceNormal = length(normalSampled) > 0.01
                        ? normalize(normalSampled + vNormal * 0.6)
                        : normalize(vNormal);

                    vec3 worldToEye = uEye - vWorldPos;
                    vec3 eyeDir = normalize(worldToEye);
                    float viewDist = length(worldToEye);

                    // ────────────────────────────────────────────────────────
                    // BASE LAKE COLOR (Ghibli teal-to-violet depth gradient)
                    // ────────────────────────────────────────────────────────
                    float depthFactor = smoothstep(0.0, 35.0, viewDist);
                    vec3 baseColor = mix(uShallowColor, uDeepColor, depthFactor);

                    // ────────────────────────────────────────────────────────
                    // MIRROR REFLECTION (screen-space oblique-clipped).
                    // Guard against the case where vMirrorCoord.w approaches 0
                    // (oblique-clip projection edge case during camera
                    // breathing) — division by ~0 produces Inf which feeds NaN
                    // into the bloom mipmap chain and blackens the full frame.
                    // ────────────────────────────────────────────────────────
                    vec3 reflectionSample = baseColor;
                    if (uReflectionStrength > 0.001) {
                        vec2 reflDistortion = surfaceNormal.xz * (0.002 + 1.0 / viewDist) * uDistortionScale * 0.5;
                        float safeW = max(abs(vMirrorCoord.w), 1e-3);
                        vec2 reflUV = clamp(vMirrorCoord.xy / safeW + reflDistortion, 0.0, 1.0);
                        reflectionSample = texture2D(uMirrorSampler, reflUV).rgb;
                        // Discard any NaN/Inf that may still survive (corrupted RT).
                        // step(0.0, sum) returns 0 for NaN (NaN never compares >= 0).
                        float sampleValid = step(0.0, reflectionSample.r + reflectionSample.g + reflectionSample.b);
                        reflectionSample = mix(baseColor, reflectionSample, sampleValid);
                    }

                    // ────────────────────────────────────────────────────────
                    // FRESNEL (more reflection at glancing angles)
                    // ────────────────────────────────────────────────────────
                    float theta = max(dot(eyeDir, surfaceNormal), 0.0);
                    float fresnel = pow(1.0 - theta, 5.0);
                    fresnel = clamp(fresnel, 0.0, 1.0);

                    // ────────────────────────────────────────────────────────
                    // MOON COLUMN — the focal element. Strong vertical glow
                    // streak below the moon, modulated by ripple shimmer.
                    // ────────────────────────────────────────────────────────
                    float moonColX = vWorldPos.x - uMoonPosition.x;
                    float moonColumn = exp(-moonColX * moonColX * 0.04);
                    moonColumn *= smoothstep(-30.0, 0.0, vWorldPos.z);

                    float shimmer = snoise(vec3(vWorldPos.xz * 0.5, uTime * 0.6)) * 0.5 + 0.5;
                    shimmer *= snoise(vec3(vWorldPos.xz * 1.4, uTime * 0.9)) * 0.5 + 0.5;
                    shimmer = pow(shimmer, 0.7);

                    float moonReflMask = moonColumn * shimmer * uMoonGlow;

                    // ────────────────────────────────────────────────────────
                    // CAUSTICS — voronoi pattern, dimmed inside moon column to
                    // avoid muddy overlap with the glow.
                    // ────────────────────────────────────────────────────────
                    vec2 causticsUV = vWorldPos.xz * 0.35 + uTime * 0.18;
                    vec2 vor = voronoi(causticsUV);
                    float caustics = 1.0 - smoothstep(0.0, 0.22, length(vor));
                    caustics *= depthFactor * 0.45;
                    caustics *= (1.0 - moonColumn * 0.7);

                    baseColor += uMoonColor * caustics * 0.45;

                    // ────────────────────────────────────────────────────────
                    // SHORE FOAM — narrow band of foam at the lake's far & near
                    // edges only. Water plane spans z=-55..+55; foam only in
                    // the outermost ~5 units of each edge.
                    // ────────────────────────────────────────────────────────
                    float foamBack = 1.0 - smoothstep(-55.0, -50.0, vWorldPos.z);
                    float foamFront = smoothstep(50.0, 55.0, vWorldPos.z);
                    float foamEdge = max(foamBack, foamFront);
                    float foamNoise = snoise(vec3(vWorldPos.xz * 0.6, uTime * 0.4)) * 0.5 + 0.5;
                    float foam = foamEdge * foamNoise * 0.35;

                    // ────────────────────────────────────────────────────────
                    // COMPOSITE
                    // ────────────────────────────────────────────────────────
                    vec3 albedo = mix(baseColor, reflectionSample, fresnel * uReflectionStrength);
                    albedo += uMoonColor * moonReflMask * 0.6;
                    albedo += vec3(0.85, 0.92, 1.0) * foam;

                    // Game event glow boost
                    albedo += uMoonColor * uGlowIntensity * 0.25;

                    // Soft edge fade (prevents hard mesh edge against fog)
                    vec2 uvOffset = vUv - 0.5;
                    float distFromCenter = length(uvOffset) * 2.0;
                    float edgeAlpha = 1.0 - smoothstep(0.9, 1.0, distFromCenter);

                    gl_FragColor = vec4(albedo, uAlpha * edgeAlpha);

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }
            `,
        };

        const material = new ShaderMaterial({
            name: lakeShader.name,
            uniforms: UniformsUtils.clone(lakeShader.uniforms),
            vertexShader: lakeShader.vertexShader,
            fragmentShader: lakeShader.fragmentShader,
            side,
            fog,
            transparent: true,
            depthWrite: true,
            depthTest: true,
        });

        material.uniforms.uMirrorSampler.value = renderTarget.texture;
        material.uniforms.uTextureMatrix.value = textureMatrix;
        material.uniforms.uAlpha.value = alpha;
        material.uniforms.uTime.value = time;
        material.uniforms.uNormalSampler.value = normalSampler;
        material.uniforms.uMoonDirection.value.copy(moonDirection);
        material.uniforms.uMoonColor.value.copy(moonColor);
        material.uniforms.uDeepColor.value.copy(deepColor);
        material.uniforms.uShallowColor.value.copy(shallowColor);
        material.uniforms.uDistortionScale.value = distortionScale;
        material.uniforms.uReflectionStrength.value = reflectionStrength;
        material.uniforms.uEye.value = eye;

        scope.material = material;

        // External flag set by theme: skip reflection rendering for perf debug
        scope.disableReflection = false;

        const disableReflections = (message, detail) => {
            scope.disableReflection = true;
            material.uniforms.uReflectionStrength.value = 0.0;
            console.warn(message, detail);
        };

        // ───────────────────────────────────────────────────────────────────
        // MIRROR CAMERA REFLECTION RENDERING (oblique-clipped)
        //
        // IMPORTANT: This is NOT wired to onBeforeRender — that pattern fired
        // a nested renderer.render() while EffectComposer was mid-pass and
        // produced intermittent whole-screen black frames as the composer's
        // internal render-target/state machine got corrupted. Instead the
        // theme calls renderReflection() once per frame, BEFORE composer.render().
        // ───────────────────────────────────────────────────────────────────
        scope.renderReflection = function (renderer, scene, camera) {
            if (scope.disableReflection) return;

            mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
            cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

            rotationMatrix.extractRotation(scope.matrixWorld);

            // Water plane normal in world space. The geometry was rotated
            // -π/2 around X, so the lake surface points world +Y directly.
            normal.set(0, 1, 0);
            normal.applyMatrix4(rotationMatrix);

            view.subVectors(mirrorWorldPosition, cameraWorldPosition);

            // Skip if camera is BELOW water (looking up at underside).
            // Reflected logic: dot(view, normal) is positive when the
            // camera-to-water vector points the same way as the normal,
            // meaning the camera is below — bail in that case.
            if (view.dot(normal) > 0) return;

            view.reflect(normal).negate();
            view.add(mirrorWorldPosition);

            rotationMatrix.extractRotation(camera.matrixWorld);

            lookAtPosition.set(0, 0, -1);
            lookAtPosition.applyMatrix4(rotationMatrix);
            lookAtPosition.add(cameraWorldPosition);

            target.subVectors(mirrorWorldPosition, lookAtPosition);
            target.reflect(normal).negate();
            target.add(mirrorWorldPosition);

            mirrorCamera.position.copy(view);
            mirrorCamera.up.set(0, 1, 0);
            mirrorCamera.up.applyMatrix4(rotationMatrix);
            mirrorCamera.up.reflect(normal);
            mirrorCamera.lookAt(target);

            mirrorCamera.far = camera.far;

            mirrorCamera.updateMatrixWorld();
            mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

            textureMatrix.set(
                0.5,
                0.0,
                0.0,
                0.5,
                0.0,
                0.5,
                0.0,
                0.5,
                0.0,
                0.0,
                0.5,
                0.5,
                0.0,
                0.0,
                0.0,
                1.0,
            );
            textureMatrix.multiply(mirrorCamera.projectionMatrix);
            textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

            mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
            mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

            clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

            const { projectionMatrix } = mirrorCamera;

            q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
            q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
            q.z = -1.0;
            q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

            const clipDenominator = clipPlane.dot(q);
            if (!Number.isFinite(clipDenominator) || Math.abs(clipDenominator) < 1e-6) {
                return;
            }

            clipPlane.multiplyScalar(2.0 / clipDenominator);

            projectionMatrix.elements[2] = clipPlane.x;
            projectionMatrix.elements[6] = clipPlane.y;
            projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
            projectionMatrix.elements[14] = clipPlane.w;

            eye.setFromMatrixPosition(camera.matrixWorld);

            const currentRenderTarget = renderer.getRenderTarget();
            const currentXrEnabled = renderer.xr ? renderer.xr.enabled : false;
            const currentShadowAutoUpdate = renderer.shadowMap ? renderer.shadowMap.autoUpdate : false;

            const restoreRendererState = () => {
                scope.visible = true;

                if (renderer.xr) renderer.xr.enabled = currentXrEnabled;
                if (renderer.shadowMap) renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

                renderer.setRenderTarget(currentRenderTarget);

                const { viewport } = camera;
                if (viewport !== undefined && renderer.state) {
                    renderer.state.viewport(viewport);
                }

                // Fully reset renderer GPU state so the subsequent composer.render()
                // starts from a known baseline. Without this, residual state from
                // the mirror render (blend mode, depth test, cull face) could leak
                // into the composer's RenderPass and produce intermittent
                // whole-screen black frames where the first few draws inherit
                // wrong state and discard their fragments.
                if (typeof renderer.resetState === 'function') {
                    renderer.resetState();
                } else if (renderer.state && typeof renderer.state.reset === 'function') {
                    renderer.state.reset();
                }
            };

            try {
                renderer.setRenderTarget(renderTarget);

                const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null;
                if (gl && typeof gl.checkFramebufferStatus === 'function') {
                    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
                    if (status !== gl.FRAMEBUFFER_COMPLETE) {
                        disableReflections('[MistyLakeWater] Disabling reflections: framebuffer incomplete', status);
                        return;
                    }
                }

                scope.visible = false;

                if (renderer.xr) renderer.xr.enabled = false;
                if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;

                if (renderer.state && renderer.state.buffers && renderer.state.buffers.depth) {
                    renderer.state.buffers.depth.setMask(true);
                }

                if (renderer.autoClear === false) renderer.clear();
                renderer.render(scene, mirrorCamera);
            } catch (error) {
                disableReflections('[MistyLakeWater] Disabling reflections after render failure', error);
            } finally {
                restoreRendererState();
            }
        };

        scope.dispose = function () {
            renderTarget.dispose();
            material.dispose();
            if (scope.geometry) scope.geometry.dispose();
        };

        scope.setReflectionTargetSize = function (width, height) {
            renderTarget.setSize(width, height);
        };
    }
}

export { MistyLakeWater };
