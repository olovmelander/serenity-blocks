/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SUNSET OCEAN WATER - Reflective Ocean with Day-Night Cycle
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Based on Three.js Water.js and SwedishForestWater with adaptations for:
 * - Dynamic day-night color transitions
 * - Dual sun AND moon reflection paths
 * - Ocean-scale wave patterns (larger, slower swells)
 * - Horizon masking for celestial bodies
 *
 * Original Three.js Water.js:
 * The MIT License
 * Copyright © 2010-2025 three.js authors
 * https://github.com/mrdoob/three.js/blob/dev/LICENSE
 */

import {
    Color,
    FrontSide,
    Matrix4,
    Mesh,
    PerspectiveCamera,
    Plane,
    ShaderMaterial,
    UniformsLib,
    UniformsUtils,
    Vector3,
    Vector4,
    WebGLRenderTarget,
} from 'three';

class SunsetOceanWater extends Mesh {
    constructor(geometry, options = {}) {
        super(geometry);

        this.isWater = true;

        const scope = this;

        // Configuration
        const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
        const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;
        const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
        const alpha = options.alpha !== undefined ? options.alpha : 0.95;
        const time = options.time !== undefined ? options.time : 0.0;
        const normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
        const sunDirection = options.sunDirection !== undefined ? options.sunDirection : new Vector3(0.70707, 0.70707, 0.0);
        const sunColor = new Color(options.sunColor !== undefined ? options.sunColor : 0xffd700);
        const waterColor = new Color(options.waterColor !== undefined ? options.waterColor : 0x1a3a5c);
        const eye = options.eye !== undefined ? options.eye : new Vector3(0, 0, 0);
        const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 3.0;
        const side = options.side !== undefined ? options.side : FrontSide;
        const fog = options.fog !== undefined ? options.fog : false;

        // Mirror reflection setup
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
        const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight);

        const oceanShader = {

            name: 'SunsetOceanWaterShader',

            uniforms: UniformsUtils.merge([
                UniformsLib.fog,
                UniformsLib.lights,
                {
                    // Standard water uniforms
                    normalSampler: { value: null },
                    mirrorSampler: { value: null },
                    alpha: { value: 0.95 },
                    time: { value: 0.0 },
                    size: { value: 1.0 },
                    distortionScale: { value: 3.0 },
                    textureMatrix: { value: new Matrix4() },
                    sunColor: { value: new Color(0xffd700) },
                    sunDirection: { value: new Vector3(0.70707, 0.70707, 0) },
                    eye: { value: new Vector3() },
                    waterColor: { value: new Color(0x1a3a5c) },

                    // Day-night cycle uniforms
                    uDayProgress: { value: 0.5 },

                    // Dynamic water colors (updated by theme)
                    uNearColor: { value: new Color(0x1a3a5c) }, // Deep color near camera
                    uFarColor: { value: new Color(0xff6b35) }, // Horizon color

                    // Celestial body positions and intensities
                    uSunPosition: { value: new Vector3(0, 10, -50) },
                    uMoonPosition: { value: new Vector3(0, -30, -70) },
                    uSunIntensity: { value: 1.0 },
                    uMoonIntensity: { value: 0.0 },
                    uSunReflectColor: { value: new Color(0xffd700) },
                    uMoonReflectColor: { value: new Color(0xf5f5dc) },
                },
            ]),

            vertexShader: /* glsl */`
                uniform mat4 textureMatrix;
                uniform float time;

                varying vec4 mirrorCoord;
                varying vec4 worldPosition;
                varying vec2 vUv;
                varying float vElevation;

                #include <common>
                #include <fog_pars_vertex>
                #include <shadowmap_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                void main() {
                    vUv = uv;

                    vec3 pos = position;
                    
                    // ═══════════════════════════════════════════════════════════════
                    // OCEAN-SCALE WAVE DISPLACEMENT
                    // Larger, slower swells for open ocean feel
                    // ═══════════════════════════════════════════════════════════════
                    
                    // Calculate distance from camera for wave attenuation
                    // Reduce wave amplitude at distance to prevent visible mesh edges
                    float distFromCenter = length(pos.xz);
                    float distanceFade = 1.0 - smoothstep(50.0, 250.0, distFromCenter);
                    
                    // Primary ocean swell - long wavelength
                    float wave1 = sin(pos.x * 0.008 + time * 0.25) * cos(pos.z * 0.006 + time * 0.2);
                    
                    // Secondary cross-swell
                    float wave2 = sin(pos.x * 0.012 - time * 0.18) * cos(pos.z * 0.01 + time * 0.22);
                    
                    // Long rolling wave
                    float wave3 = sin((pos.x + pos.z) * 0.005 + time * 0.15);
                    
                    // Medium surface ripples - fade faster with distance
                    float wave4 = sin(pos.x * 0.02 + time * 0.35) * cos(pos.z * 0.018 + time * 0.28) * 0.4 * distanceFade;
                    
                    // Small detail waves - fade most with distance
                    float wave5 = sin(pos.x * 0.04 - time * 0.5) * cos(pos.z * 0.035 + time * 0.4) * 0.15 * distanceFade * distanceFade;
                    
                    // Apply overall distance attenuation to wave height
                    float waveScale = mix(0.3, 1.0, distanceFade);
                    float elevation = (wave1 * 1.2 + wave2 * 0.8 + wave3 * 0.6 + wave4 + wave5) * 0.5 * waveScale;
                    pos.y += elevation;
                    vElevation = elevation;

                    mirrorCoord = modelMatrix * vec4(pos, 1.0);
                    worldPosition = mirrorCoord.xyzw;
                    mirrorCoord = textureMatrix * mirrorCoord;
                    
                    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
                    gl_Position = projectionMatrix * mvPosition;

                    #include <beginnormal_vertex>
                    #include <defaultnormal_vertex>
                    #include <logdepthbuf_vertex>
                    #include <fog_vertex>
                    #include <shadowmap_vertex>
                }
            `,

            fragmentShader: /* glsl */`
                uniform sampler2D mirrorSampler;
                uniform sampler2D normalSampler;
                uniform float alpha;
                uniform float time;
                uniform float size;
                uniform float distortionScale;
                uniform vec3 sunColor;
                uniform vec3 sunDirection;
                uniform vec3 eye;
                uniform vec3 waterColor;
                
                // Day-night uniforms
                uniform float uDayProgress;
                uniform vec3 uNearColor;
                uniform vec3 uFarColor;
                
                // Celestial body uniforms
                uniform vec3 uSunPosition;
                uniform vec3 uMoonPosition;
                uniform float uSunIntensity;
                uniform float uMoonIntensity;
                uniform vec3 uSunReflectColor;
                uniform vec3 uMoonReflectColor;

                varying vec4 mirrorCoord;
                varying vec4 worldPosition;
                varying vec2 vUv;
                varying float vElevation;

                // ═══════════════════════════════════════════════════════════════
                // WAVE NORMAL SAMPLING
                // ═══════════════════════════════════════════════════════════════
                vec4 getNoise(vec2 uv) {
                    // Ocean-scale UV scrolling for normal map
                    vec2 uv0 = (uv / 300.0) + vec2(time / 50.0, time / 60.0);
                    vec2 uv1 = (uv / 250.0) - vec2(time / 55.0, time / 65.0);
                    vec2 uv2 = (uv / 400.0) + vec2(time / 80.0, -time / 70.0);
                    
                    vec4 noise = texture2D(normalSampler, uv0) +
                                 texture2D(normalSampler, uv1) +
                                 texture2D(normalSampler, uv2) * 0.5;
                    
                    return noise * 0.2 - 0.3;
                }

                // ═══════════════════════════════════════════════════════════════
                // 3D NOISE FOR FOAM EFFECTS
                // ═══════════════════════════════════════════════════════════════
                vec3 hash3(vec3 p) {
                    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                             dot(p, vec3(269.5, 183.3, 246.1)),
                             dot(p, vec3(113.5, 271.9, 124.6)));
                    return fract(sin(p) * 43758.5453123);
                }
                
                float noise3D(vec3 p) {
                    vec3 i = floor(p);
                    vec3 f = fract(p);
                    f = f * f * (3.0 - 2.0 * f);
                    
                    float n = mix(
                        mix(mix(dot(hash3(i), f),
                                dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), f.x),
                            mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                                dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), f.x), f.y),
                        mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                                dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), f.x),
                            mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                                dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), f.x), f.y), f.z);
                    return n * 0.5 + 0.5;
                }

                // ═══════════════════════════════════════════════════════════════
                // SUN/MOON SPECULAR LIGHTING
                // ═══════════════════════════════════════════════════════════════
                void celestialLight(
                    const vec3 surfaceNormal, 
                    const vec3 eyeDirection, 
                    float shiny, 
                    float spec, 
                    float diffuse,
                    float intensity,
                    vec3 lightColor,
                    inout vec3 diffuseColor, 
                    inout vec3 specularColor
                ) {
                    vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));
                    float direction = max(0.0, dot(eyeDirection, reflection));
                    
                    // Bright specular highlight
                    specularColor += pow(direction, shiny) * lightColor * spec * intensity * 3.0;
                    
                    // Wider soft glow for celestial path
                    specularColor += pow(direction, shiny * 0.15) * lightColor * spec * intensity * 0.8;
                    
                    // Diffuse contribution
                    diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * lightColor * diffuse * intensity;
                }

                #include <common>
                #include <packing>
                #include <bsdfs>
                #include <fog_pars_fragment>
                #include <logdepthbuf_pars_fragment>
                #include <lights_pars_begin>
                #include <shadowmap_pars_fragment>
                #include <shadowmask_pars_fragment>

                void main() {
                    #include <logdepthbuf_fragment>

                    vec4 noise = getNoise(worldPosition.xz * size);
                    
                    // Surface normal with wave distortion
                    // Fallback to up-facing normal if texture hasn't loaded
                    vec3 rawNormal = noise.xzy * vec3(0.6, 1.0, 0.6);
                    float normalLength = length(rawNormal);
                    vec3 surfaceNormal = normalLength > 0.01 ? 
                        normalize(rawNormal) : 
                        vec3(0.0, 1.0, 0.0);

                    vec3 diffuseLight = vec3(0.0);
                    vec3 specularLight = vec3(0.0);

                    vec3 worldToEye = eye - worldPosition.xyz;
                    vec3 eyeDirection = normalize(worldToEye);
                    float distance = length(worldToEye);

                    // ═══════════════════════════════════════════════════════════════
                    // CELESTIAL LIGHTING (Sun during day, Moon at night)
                    // ═══════════════════════════════════════════════════════════════
                    
                    // Sun contribution
                    celestialLight(surfaceNormal, eyeDirection, 60.0, 2.0, 0.5, 
                                   uSunIntensity, uSunReflectColor, diffuseLight, specularLight);
                    
                    // Moon contribution (softer, cooler)
                    celestialLight(surfaceNormal, eyeDirection, 40.0, 1.5, 0.3, 
                                   uMoonIntensity, uMoonReflectColor, diffuseLight, specularLight);

                    // ═══════════════════════════════════════════════════════════════
                    // REFLECTION SAMPLING
                    // ═══════════════════════════════════════════════════════════════
                    
                    vec2 distortion = surfaceNormal.xz * (0.001 + 1.0 / distance) * distortionScale * 0.4;
                    vec3 reflectionSample = texture2D(mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion).rgb;

                    // Fresnel effect - more reflection at glancing angles
                    float theta = max(dot(eyeDirection, surfaceNormal), 0.0);
                    float rf0 = 0.04;  // Low for water
                    float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 4.0);

                    // ═══════════════════════════════════════════════════════════════
                    // DEPTH-BASED COLOR GRADIENT
                    // ═══════════════════════════════════════════════════════════════
                    
                    float depthFactor = smoothstep(30.0, 300.0, distance);
                    vec3 oceanBase = mix(uNearColor, uFarColor, depthFactor);

                    // ═══════════════════════════════════════════════════════════════
                    // SUN REFLECTION PATH
                    // Bright shimmering column toward the sun - smoothed
                    // ═══════════════════════════════════════════════════════════════
                    
                    float sunPathX = abs(worldPosition.x - uSunPosition.x) / 150.0;
                    float sunPath = 1.0 - smoothstep(0.0, 0.5, sunPathX);
                    sunPath *= sunPath;  // Sharpen falloff
                    sunPath *= smoothstep(50.0, 200.0, distance);  // Only toward horizon
                    sunPath *= uSunIntensity;
                    
                    // Smooth shimmer - use noise-based approach instead of grid-aligned sin
                    float shimmerTime = time * 1.5;
                    float shimmer = noise.x * 0.7 + 0.3;  // Use normal texture for organic shimmer
                    shimmer *= smoothstep(0.2, 0.6, noise.y + 0.3);  // Add variation
                    sunPath *= (0.4 + shimmer * 0.6);

                    // ═══════════════════════════════════════════════════════════════
                    // MOON REFLECTION PATH
                    // Softer, silvery shimmer column - smoothed
                    // ═══════════════════════════════════════════════════════════════
                    
                    float moonPathX = abs(worldPosition.x - uMoonPosition.x) / 130.0;
                    float moonPath = 1.0 - smoothstep(0.0, 0.4, moonPathX);
                    moonPath *= moonPath;
                    moonPath *= smoothstep(50.0, 200.0, distance);  // Only toward horizon
                    moonPath *= uMoonIntensity;
                    
                    // Smooth moon shimmer using noise texture
                    float moonShimmer = noise.z * 0.5 + 0.5;
                    moonPath *= moonShimmer;

                    // ═══════════════════════════════════════════════════════════════
                    // WAVE CREST HIGHLIGHTS
                    // ═══════════════════════════════════════════════════════════════
                    
                    float crestHighlight = smoothstep(0.0, 0.5, vElevation) * 0.25;
                    vec3 crestColor = mix(uFarColor, vec3(1.0), 0.3);
                    oceanBase += crestColor * crestHighlight * (uSunIntensity * 0.8 + uMoonIntensity * 0.4);

                    // ═══════════════════════════════════════════════════════════════
                    // HORIZON FOG BLEND
                    // Smooth transition where water meets sky
                    // ═══════════════════════════════════════════════════════════════
                    
                    float horizonFog = smoothstep(200.0, 400.0, distance);
                    oceanBase = mix(oceanBase, uFarColor, horizonFog * 0.5);

                    // ═══════════════════════════════════════════════════════════════
                    // FINAL COLOR COMPOSITION
                    // ═══════════════════════════════════════════════════════════════
                    
                    // Scatter (subsurface scattering simulation)
                    vec3 scatter = max(0.0, dot(surfaceNormal, eyeDirection)) * waterColor * 0.15;

                    // Blend reflection with ocean base
                    vec3 albedo = mix(
                        (sunColor * diffuseLight * 0.1 + scatter) * getShadowMask(),
                        (oceanBase * 0.85 + reflectionSample * 0.15),
                        reflectance * 0.6
                    );
                    
                    // Add specular highlights
                    albedo += specularLight * 0.5;

                    // Add celestial reflection paths
                    albedo += uSunReflectColor * sunPath * 0.9;
                    albedo += uMoonReflectColor * moonPath * 0.7;

                    // ═══════════════════════════════════════════════════════════════
                    // BIOLUMINESCENT FOAM AT WAVE CRESTS
                    // Magical teal glow that appears on wave peaks
                    // ═══════════════════════════════════════════════════════════════
                    
                    // Foam appears at wave crests (high elevation)
                    float foamMask = smoothstep(0.15, 0.5, vElevation);
                    
                    // Animated noise for organic foam pattern
                    float foamNoise = noise3D(worldPosition.xyz * 0.08 + vec3(time * 0.4, time * 0.2, time * 0.3));
                    foamNoise *= noise3D(worldPosition.xyz * 0.15 - vec3(time * 0.25));
                    
                    // Combine mask with noise for natural distribution
                    float foam = foamMask * foamNoise * 2.0;
                    foam = clamp(foam, 0.0, 1.0);
                    
                    // Bioluminescent teal color - stronger at night
                    float nightAmount = 1.0 - uSunIntensity;
                    vec3 bioColor = vec3(0.1, 0.85, 0.75);  // Luminous teal
                    vec3 foamGlow = bioColor * foam * (0.15 + nightAmount * 0.35);
                    
                    // Add foam to final color
                    albedo += foamGlow;

                    // Edge fade for smooth blending with scene edges
                    vec2 uvOffset = vUv - 0.5;
                    float distFromCenter = length(uvOffset) * 2.0;
                    float edgeAlpha = 1.0 - smoothstep(0.95, 1.0, distFromCenter);

                    gl_FragColor = vec4(albedo, alpha * edgeAlpha);

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }
            `,
        };

        // Create material
        const material = new ShaderMaterial({
            name: oceanShader.name,
            uniforms: UniformsUtils.clone(oceanShader.uniforms),
            vertexShader: oceanShader.vertexShader,
            fragmentShader: oceanShader.fragmentShader,
            lights: true,
            side,
            fog,
            transparent: true,
            depthWrite: true,  // Ensure ocean writes to depth buffer to occlude objects behind it
            depthTest: true,
        });

        // Initialize uniforms
        material.uniforms.mirrorSampler.value = renderTarget.texture;
        material.uniforms.textureMatrix.value = textureMatrix;
        material.uniforms.alpha.value = alpha;
        material.uniforms.time.value = time;
        material.uniforms.normalSampler.value = normalSampler;
        material.uniforms.sunColor.value = sunColor;
        material.uniforms.waterColor.value = waterColor;
        material.uniforms.sunDirection.value = sunDirection;
        material.uniforms.distortionScale.value = distortionScale;
        material.uniforms.eye.value = eye;

        scope.material = material;

        // ═══════════════════════════════════════════════════════════════════════
        // MIRROR CAMERA REFLECTION RENDERING
        // ═══════════════════════════════════════════════════════════════════════

        scope.onBeforeRender = function (renderer, scene, camera) {
            mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
            cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

            rotationMatrix.extractRotation(scope.matrixWorld);

            normal.set(0, 0, 1);
            normal.applyMatrix4(rotationMatrix);

            view.subVectors(mirrorWorldPosition, cameraWorldPosition);

            // Avoid rendering when mirror is facing away
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

            // Update texture matrix
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

            // Oblique clipping plane
            mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
            mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

            clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

            const { projectionMatrix } = mirrorCamera;

            q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
            q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
            q.z = -1.0;
            q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

            clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

            projectionMatrix.elements[2] = clipPlane.x;
            projectionMatrix.elements[6] = clipPlane.y;
            projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
            projectionMatrix.elements[14] = clipPlane.w;

            eye.setFromMatrixPosition(camera.matrixWorld);

            // Render reflection
            const currentRenderTarget = renderer.getRenderTarget();
            const currentXrEnabled = renderer.xr.enabled;
            const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

            scope.visible = false;

            renderer.xr.enabled = false;
            renderer.shadowMap.autoUpdate = false;

            renderer.setRenderTarget(renderTarget);
            renderer.state.buffers.depth.setMask(true);

            if (renderer.autoClear === false) renderer.clear();
            renderer.render(scene, mirrorCamera);

            scope.visible = true;

            renderer.xr.enabled = currentXrEnabled;
            renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

            renderer.setRenderTarget(currentRenderTarget);

            // Restore viewport
            const { viewport } = camera;
            if (viewport !== undefined) {
                renderer.state.viewport(viewport);
            }
        };
    }
}

export { SunsetOceanWater };
