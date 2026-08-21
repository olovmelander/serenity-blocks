/**
 * Golden Forest Water - Custom Water shader with reduced Fresnel for orange evening look
 * Based on Three.js Water.js with modifications:
 * - Reduced Fresnel coefficient (0.3 -> 0.05) for less blue sky reflection
 * - Depth gradient: warm orange near camera, lighter golden toward horizon
 * - Reduced reflection blend weight for warmer tones
 * - Simplified wave pattern for smoother surface
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

class GoldenForestWater extends Mesh {
    constructor(geometry, options = {}) {
        super(geometry);

        this.isWater = true;

        const scope = this;

        const textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
        const textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;

        const clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
        const alpha = options.alpha !== undefined ? options.alpha : 1.0;
        const time = options.time !== undefined ? options.time : 0.0;
        const normalSampler = options.waterNormals !== undefined ? options.waterNormals : null;
        const sunDirection = options.sunDirection !== undefined ? options.sunDirection : new Vector3(0.70707, 0.70707, 0.0);
        const sunColor = new Color(options.sunColor !== undefined ? options.sunColor : 0xffffff);
        const waterColor = new Color(options.waterColor !== undefined ? options.waterColor : 0x7F7F7F);
        const eye = options.eye !== undefined ? options.eye : new Vector3(0, 0, 0);
        const distortionScale = options.distortionScale !== undefined ? options.distortionScale : 20.0;
        const side = options.side !== undefined ? options.side : FrontSide;
        const fog = options.fog !== undefined ? options.fog : false;

        //

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
        this.mirrorCamera = mirrorCamera;

        const renderTarget = new WebGLRenderTarget(textureWidth, textureHeight);
        this.renderTarget = renderTarget;

        const mirrorShader = {

            name: 'GoldenForestWaterShader',

            uniforms: UniformsUtils.merge([
                UniformsLib.fog,
                UniformsLib.lights,
                {
                    normalSampler: { value: null },
                    mirrorSampler: { value: null },
                    alpha: { value: 1.0 },
                    time: { value: 0.0 },
                    size: { value: 1.0 },
                    distortionScale: { value: 20.0 },
                    textureMatrix: { value: new Matrix4() },
                    sunColor: { value: new Color(0x7F7F7F) },
                    sunDirection: { value: new Vector3(0.70707, 0.70707, 0) },
                    eye: { value: new Vector3() },
                    waterColor: { value: new Color(0x555555) },
                },
            ]),

            vertexShader: /* glsl */`
                uniform mat4 textureMatrix;
                uniform float time;

                varying vec4 mirrorCoord;
                varying vec4 worldPosition;
                varying vec2 vUv;

                #include <common>
                #include <fog_pars_vertex>
                #include <shadowmap_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                void main() {
                    vUv = uv;

                    // Gentle wave displacement - slow rolling motion
                    vec3 pos = position;
                    float wave1 = sin(position.x * 0.015 + time * 0.4) * cos(position.z * 0.012 + time * 0.3);
                    float wave2 = sin(position.x * 0.008 - time * 0.25) * cos(position.z * 0.01 + time * 0.35);
                    float wave3 = sin((position.x + position.z) * 0.006 + time * 0.2);
                    pos.y += (wave1 * 0.8 + wave2 * 0.5 + wave3 * 0.3) * 0.4;

                    mirrorCoord = modelMatrix * vec4( pos, 1.0 );
                    worldPosition = mirrorCoord.xyzw;
                    mirrorCoord = textureMatrix * mirrorCoord;
                    vec4 mvPosition =  modelViewMatrix * vec4( pos, 1.0 );
                    gl_Position = projectionMatrix * mvPosition;

                #include <beginnormal_vertex>
                #include <defaultnormal_vertex>
                #include <logdepthbuf_vertex>
                #include <fog_vertex>
                #include <shadowmap_vertex>
            }`,

            fragmentShader: /* glsl */`
                uniform sampler2D mirrorSampler;
                uniform float alpha;
                uniform float time;
                uniform float size;
                uniform float distortionScale;
                uniform sampler2D normalSampler;
                uniform vec3 sunColor;
                uniform vec3 sunDirection;
                uniform vec3 eye;
                uniform vec3 waterColor;

                varying vec4 mirrorCoord;
                varying vec4 worldPosition;
                varying vec2 vUv;

                // CARTOONY: Simplified wave function - larger, smoother waves
                vec4 getNoise( vec2 uv ) {
                    // Simpler, larger wave pattern for cartoon look
                    vec2 uv0 = ( uv / 200.0 ) + vec2(time / 40.0, time / 50.0);
                    vec2 uv1 = ( uv / 180.0 ) - vec2(time / 45.0, time / 55.0);
                    vec4 noise = texture2D( normalSampler, uv0 ) +
                        texture2D( normalSampler, uv1 );
                    return noise * 0.25 - 0.25;  // Reduced intensity for subtler waves
                }

                // Sun specular reflection - enhanced for bright sun path
                void sunLight( const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor ) {
                    vec3 reflection = normalize( reflect( -sunDirection, surfaceNormal ) );
                    float direction = max( 0.0, dot( eyeDirection, reflection ) );
                    // Piercing sun specular highlight
                    specularColor += pow( direction, shiny * 2.0 ) * sunColor * spec * 3.5;
                    // Broad, intense sun glow path
                    specularColor += pow( direction, shiny * 0.1 ) * sunColor * spec * 0.8;
                    diffuseColor += max( dot( sunDirection, surfaceNormal ), 0.0 ) * sunColor * diffuse;
                }

                // Procedural tree shadow function for reflections (Firewatch style)
                float treeReflectionPattern( vec2 pos, float t ) {
                    // Soft tree silhouettes reflected in water
                    float trees = 0.0;

                    // Layer 1 - Distant tree line (soft gradient)
                    float x1 = pos.x * 0.04;
                    float treeLine1 = sin(x1 * 2.0) * 0.3 + sin(x1 * 5.0) * 0.15;
                    float treeHeight1 = 0.5 + treeLine1;
                    // Soft transition instead of hard step
                    float inTree1 = smoothstep(treeHeight1 + 0.08, treeHeight1 - 0.02, pos.y) * smoothstep(0.1, 0.2, pos.y);
                    trees = max(trees, inTree1 * 0.7);

                    // Layer 2 - Mid trees
                    float x2 = pos.x * 0.07 + 2.0;
                    float treeLine2 = sin(x2 * 3.0) * 0.22 + sin(x2 * 7.0) * 0.1;
                    float treeHeight2 = 0.38 + treeLine2;
                    float inTree2 = smoothstep(treeHeight2 + 0.06, treeHeight2 - 0.02, pos.y) * smoothstep(0.08, 0.15, pos.y);
                    trees = max(trees, inTree2 * 0.5);

                    return trees;
                }

                // Subtle cel-shading quantization
                vec3 quantizeColor( vec3 color, float levels ) {
                    return floor( color * levels ) / levels;
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
                    vec4 noise = getNoise( worldPosition.xz * size );
                    // CARTOONY: Flatter surface normal for less complex reflections
                    vec3 surfaceNormal = normalize( noise.xzy * vec3( 0.8, 1.0, 0.8 ) );

                    vec3 diffuseLight = vec3(0.0);
                    vec3 specularLight = vec3(0.0);

                    vec3 worldToEye = eye-worldPosition.xyz;
                    vec3 eyeDirection = normalize( worldToEye );
                    // Sun reflection - bright specular for visible sun path
                    sunLight( surfaceNormal, eyeDirection, 50.0, 2.2, 0.6, diffuseLight, specularLight );

                    float distance = length(worldToEye);

                    // CARTOONY: Reduced distortion for cleaner reflections
                    vec2 distortion = surfaceNormal.xz * ( 0.001 + 1.0 / distance ) * distortionScale * 0.3;
                    vec3 reflectionSample = vec3( texture2D( mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion ) );

                    float theta = max( dot( eyeDirection, surfaceNormal ), 0.0 );

                    // CARTOONY: Very low Fresnel for uniform color across surface
                    float rf0 = 0.10; // Reduced base reflectivity for deeper water
                    float reflectance = rf0 + ( 1.0 - rf0 ) * pow( ( 1.0 - theta ), 6.0 ); // Stronger rim reflections, darker base

                    vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;

                    // DEPTH GRADIENT: Rich orange sunset reflection (Firewatch aesthetic)
                    vec3 nearColor = vec3( 0.25, 0.08, 0.02 );  // Very dark, moody maroon
                    vec3 farColor = vec3( 0.75, 0.35, 0.10 );   // Muted, deeper amber
                    
                    // Smooth depth falloff - slightly further blend for more orange coverage
                    float depthFactor = smoothstep( 25.0, 180.0, distance );
                    vec3 orangeBase = mix( nearColor, farColor, depthFactor );
                    
                    // SHORE SHADOW (Vignette based on UV distance from center)
                    // UVs are circular, 0.5 is center, edge is distance 0.5
                    vec2 uvOffset = vUv - 0.5;
                    float distFromCenter = length(uvOffset) * 2.0; // 0 at center, 1.0 at edge
                    
                    // Darken very close to the edge (shore)
                    // Start darkening at 0.85, fully dark at 1.0
                    float shoreShadow = smoothstep(0.85, 1.0, distFromCenter);
                    
                    // Warm dark brown for shore shadow
                    vec3 shoreDarkColor = vec3(0.25, 0.12, 0.05);

                    // Apply subtle shore shadow to base color
                    orangeBase = mix(orangeBase, shoreDarkColor, shoreShadow * 0.6);

                    // ════════════════════════════════════════════════════════════════
                    // SHORE FOAM (animated foam near edges)
                    // ════════════════════════════════════════════════════════════════

                    // Foam appears near the shore edges
                    float foamZone = smoothstep(0.75, 0.95, distFromCenter);

                    // Animated foam pattern - multiple overlapping waves
                    float foam1 = sin(worldPosition.x * 0.8 + time * 1.2) * sin(worldPosition.z * 0.6 + time * 0.9);
                    float foam2 = sin(worldPosition.x * 1.5 - time * 0.8) * sin(worldPosition.z * 1.2 + time * 1.1);
                    float foam3 = sin((worldPosition.x + worldPosition.z) * 0.5 + time * 0.7);

                    // Combine foam patterns - creates organic, bubbly look
                    float foamPattern = (foam1 + foam2 * 0.6 + foam3 * 0.4) * 0.5 + 0.5;
                    foamPattern = smoothstep(0.3, 0.7, foamPattern); // sharpen the foam edges

                    // Foam intensity increases toward shore edge
                    float foamIntensity = foamZone * foamPattern;

                    // ════════════════════════════════════════════════════════════════
                    // OBJECT FOAM - foam around rocks and logs in the water
                    // Uses UV coordinates for reliable positioning
                    // ════════════════════════════════════════════════════════════════

                    float objectFoam = 0.0;

                    // Animated foam wave for objects
                    float objFoamWave = sin(worldPosition.x * 0.8 + time * 1.0) * sin(worldPosition.z * 0.6 + time * 0.8);
                    objFoamWave = objFoamWave * 0.25 + 0.75;

                    // Object positions in UV space (matched to actual scene objects)
                    // Log 1 (Left far)
                    vec2 rock1UV = vec2(0.37, 0.82);
                    float d1 = length(vUv - rock1UV);
                    float rock1Foam = smoothstep(0.14, 0.04, d1); // Slightly wider, softer foam
                    objectFoam = max(objectFoam, rock1Foam);

                    // Log 2 (Center far)
                    vec2 rock2UV = vec2(0.46, 0.77);
                    float d2 = length(vUv - rock2UV);
                    float rock2Foam = smoothstep(0.12, 0.03, d2);
                    objectFoam = max(objectFoam, rock2Foam);

                    // Log 3 / Shore stone (Center-right far)
                    vec2 logUV = vec2(0.58, 0.81);
                    float dLog = length(vUv - logUV);
                    float foamLog = smoothstep(0.1, 0.02, dLog);
                    objectFoam = max(objectFoam, foamLog);
                    
                    // Log 4 (Right-side water log)
                    vec2 log4UV = vec2(0.74, 0.5);
                    float d4 = length(vUv - log4UV);
                    float foam4 = smoothstep(0.12, 0.04, d4);
                    objectFoam = max(objectFoam, foam4);

                    // Log 5 (Right far)
                    vec2 log5UV = vec2(0.79, 0.39);
                    float d5 = length(vUv - log5UV);
                    float foam5 = smoothstep(0.12, 0.04, d5);
                    objectFoam = max(objectFoam, foam5);

                    // Apply wave animation
                    objectFoam *= objFoamWave * 0.8; // Reduced object foam intensity

                    // Combine shore foam and object foam
                    foamIntensity = max(foamIntensity, objectFoam);

                    // Add subtle variation
                    float foamVariation = sin(worldPosition.x * 2.0) * sin(worldPosition.z * 2.5) * 0.15 + 0.85;
                    foamIntensity *= foamVariation;

                    // Warm cream/orange foam color
                    vec3 foamColor = vec3(1.0, 0.85, 0.65);

                    // Apply foam to base color
                    orangeBase = mix(orangeBase, foamColor, foamIntensity * 0.25); // Much subtler foam blend

                    // ════════════════════════════════════════════════════════════════
                    // TREE SHADOW REFLECTIONS (Firewatch style)
                    // ════════════════════════════════════════════════════════════════

                    // Calculate tree reflection position (flip Y for reflection)
                    vec2 treeReflectPos = vec2(worldPosition.x, 1.0 - vUv.y);

                    // Add ripple distortion to break up tree reflections
                    float rippleDistort = sin(worldPosition.z * 1.5 + time * 0.6) * 0.06;
                    rippleDistort += sin(worldPosition.z * 3.0 - time * 0.4) * 0.03;
                    rippleDistort += sin(worldPosition.x * 0.8 + time * 0.3) * 0.02;
                    treeReflectPos.y += rippleDistort;

                    // Get tree shadow pattern
                    float treeShadow = treeReflectionPattern(treeReflectPos, time);

                    // Trees only visible in mid-to-far distance (not right at shore)
                    float treeMask = smoothstep(0.2, 0.5, vUv.y) * smoothstep(0.95, 0.7, distFromCenter);
                    treeShadow *= treeMask;

                    // Dark tree silhouette color (dark brown with warmth)
                    vec3 treeShadowColor = vec3(0.2, 0.1, 0.05);

                    // Apply tree shadows - subtle darkening where trees reflect
                    orangeBase = mix(orangeBase, treeShadowColor, treeShadow * 0.35);

                    // ════════════════════════════════════════════════════════════════
                    // SUN PATH REFLECTION (bright vertical column toward sun)
                    // ════════════════════════════════════════════════════════════════

                    // Sun is roughly centered, create a bright path toward it
                    float sunPathX = abs(worldPosition.x) / 80.0; // Normalize X distance from center
                    float sunPath = 1.0 - smoothstep(0.0, 0.4, sunPathX); // Bright in center, fades to sides
                    sunPath *= sunPath; // Sharpen the falloff

                    // Sun path is strongest toward horizon (far from camera)
                    sunPath *= depthFactor * 1.2;

                    // Add shimmer/sparkle to sun path
                    float sparkle = sin(worldPosition.z * 8.0 + time * 2.0) * 0.5 + 0.5;
                    sparkle *= sin(worldPosition.x * 3.0 + time * 1.5) * 0.5 + 0.5;
                    sunPath *= (0.7 + sparkle * 0.5);

                    // Blend reflections with stronger warm/orange tint
                    vec3 warmReflection = reflectionSample * 0.3 + vec3(0.25, 0.12, 0.04);

                    vec3 albedo = mix(
                        ( sunColor * diffuseLight * 0.15 + scatter * 0.2 ) * getShadowMask(),
                        ( orangeBase * 0.9 + warmReflection * 0.15 + reflectionSample * specularLight * 0.4 ),
                        reflectance * 0.7
                    );

                    // Add bright sun path on top
                    vec3 sunPathColor = vec3(1.0, 0.65, 0.2); // Saturated orange to avoid washing out
                    albedo += sunPathColor * sunPath * 0.9;

                    // SHORE FADE - Transparency at the very edge to blend with ground
                    // Start fading at 0.98, fully transparent at 1.0
                    float edgeAlpha = 1.0 - smoothstep(0.98, 1.0, distFromCenter);

                    // Smooth output without cel-shading for natural look
                    gl_FragColor = vec4( albedo, alpha * edgeAlpha );

                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                    #include <fog_fragment>
                }`,

        };

        const material = new ShaderMaterial({
            name: mirrorShader.name,
            uniforms: UniformsUtils.clone(mirrorShader.uniforms),
            vertexShader: mirrorShader.vertexShader,
            fragmentShader: mirrorShader.fragmentShader,
            lights: true,
            side,
            fog,
        });

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

            mirrorCamera.far = camera.far; // Used in WebGLBackground

            mirrorCamera.updateMatrixWorld();
            mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

            // Update the texture matrix
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

            // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
            // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
            mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
            mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

            clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

            const { projectionMatrix } = mirrorCamera;

            q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
            q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
            q.z = -1.0;
            q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

            // Calculate the scaled plane vector
            clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

            // Replacing the third row of the projection matrix
            projectionMatrix.elements[2] = clipPlane.x;
            projectionMatrix.elements[6] = clipPlane.y;
            projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
            projectionMatrix.elements[14] = clipPlane.w;

            eye.setFromMatrixPosition(camera.matrixWorld);

            // Render

            const currentRenderTarget = renderer.getRenderTarget();

            const currentXrEnabled = renderer.xr.enabled;
            const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

            scope.visible = false;

            renderer.xr.enabled = false; // Avoid camera modification and recursion
            renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows

            renderer.setRenderTarget(renderTarget);

            renderer.state.buffers.depth.setMask(true); // make sure the depth buffer is writable so it can be properly cleared, see #18897

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

    dispose() {
        this.onBeforeRender = function () { };
        if (this.renderTarget) {
            this.renderTarget.dispose();
            this.renderTarget = null;
        }
        if (this.material?.dispose) {
            this.material.dispose();
        }
        if (this.geometry?.dispose) {
            this.geometry.dispose();
        }
        this.mirrorCamera = null;
        // r186 adds Object3D.dispose() (mrdoob/three.js#34141); r185 has no base
        // dispose on Object3D/Mesh, so the optional call is a no-op today and
        // chains into the base teardown once it exists. Keep it last.
        super.dispose?.();
    }
}

export { GoldenForestWater };
