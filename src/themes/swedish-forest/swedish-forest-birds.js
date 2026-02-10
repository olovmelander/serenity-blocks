import * as THREE from 'three';
import * as THREE_WEBGPU from 'three/webgpu';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import {
    attribute,
    float,
    instanceIndex,
    length,
    max,
    positionLocal,
    sin,
    smoothstep,
    storage,
    vec3,
} from 'three/tsl';
import { SwedishForestBirdCompute } from './swedish-forest-compute.js';

export class SwedishForestBirds {
    constructor(renderer, scene, options = {}) {
        this.renderer = renderer;
        this.scene = scene;
        this.mesh = null;
        this.gpuCompute = null;
        this.birdCompute = null;
        this.randomFn = typeof options.randomFn === 'function' ? options.randomFn : Math.random;
        this.isWebGPU = renderer?.backend?.isWebGPUBackend === true;

        this.requestedBirdCount = Math.max(1, Math.floor(options.birdCount ?? 1024));
        if (this.isWebGPU) {
            this.BIRDS = this.requestedBirdCount;
            this.WIDTH = Math.max(1, Math.ceil(Math.sqrt(this.BIRDS)));
        } else {
            this.WIDTH = Math.max(1, Math.ceil(Math.sqrt(this.requestedBirdCount)));
            this.BIRDS = this.WIDTH * this.WIDTH;
        }

        // Shaders (WebGL fallback: GPUComputationRenderer + ShaderMaterial)
        this.fragmentShaderPosition = `
            uniform float time;
            uniform float delta;

            void main() {
                vec2 uv = gl_FragCoord.xy / resolution.xy;
                vec4 tmpPos = texture2D(texturePosition, uv);
                vec3 position = tmpPos.xyz;
                vec3 velocity = texture2D(textureVelocity, uv).xyz;
                float phase = tmpPos.w;

                phase = mod((phase + delta + length(velocity.xz) * delta * 3.0 + max(velocity.y, 0.0) * delta * 6.0), 62.83);

                gl_FragColor = vec4(position + velocity * delta * 15.0, phase);
            }
        `;

        this.fragmentShaderVelocity = `
            uniform float time;
            uniform float testing;
            uniform float delta; // about 0.016
            uniform float separationDistance; // 20
            uniform float alignmentDistance; // 40
            uniform float cohesionDistance; //
            uniform float freedomFactor;
            uniform vec3 predator;

            const float width = resolution.x;
            const float height = resolution.y;

            const float PI = 3.141592653589793;
            const float PI_2 = PI * 2.0;

            float zoneRadius = 40.0;
            float zoneRadiusSquared = 1600.0;

            float separationThresh = 0.45;
            float alignmentThresh = 0.65;

            const float UPPER_BOUNDS = 400.0;
            const float LOWER_BOUNDS = -400.0;

            const float SPEED_LIMIT = 5.0; // Faster for large area

            float rand(vec2 co){
                return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
            }

            void main() {
                zoneRadius = separationDistance + alignmentDistance + cohesionDistance;
                separationThresh = separationDistance / zoneRadius;
                alignmentThresh = (separationDistance + alignmentDistance) / zoneRadius;
                zoneRadiusSquared = zoneRadius * zoneRadius;

                vec2 uv = gl_FragCoord.xy / resolution.xy;
                vec3 birdPosition, birdVelocity;

                vec3 selfPosition = texture2D(texturePosition, uv).xyz;
                vec3 selfVelocity = texture2D(textureVelocity, uv).xyz;

                float dist;
                vec3 dir; // direction
                float distSquared;

                float separationSquared = separationDistance * separationDistance;
                float cohesionSquared = cohesionDistance * cohesionDistance;

                float f;
                float percent;

                vec3 velocity = selfVelocity;

                float limit = SPEED_LIMIT;

                dir = predator * UPPER_BOUNDS - selfPosition;
                dir.z = 0.;
                // dir.z *= 0.6;
                dist = length(dir);
                distSquared = dist * dist;

                float preyRadius = 150.0;
                float preyRadiusSq = preyRadius * preyRadius;

                // Move away from predator
                if (dist < preyRadius) {
                    f = (distSquared / preyRadiusSq - 1.0) * delta * 100.0;
                    velocity += normalize(dir) * f;
                    limit += 5.0;
                }

                // Interaction with other birds
                vec3 central = vec3(0., 0., 0.);
                vec3 velAvg = vec3(0., 0., 0.); // average velocity
                vec3 posAvg = vec3(0., 0., 0.); // center of flock

                float count = 0.0;

                for (float y = 0.0; y < height; y++) {
                    for (float x = 0.0; x < width; x++) {
                        vec2 ref = vec2(x + 0.5, y + 0.5) / resolution.xy;
                        birdPosition = texture2D(texturePosition, ref).xyz;

                        dir = birdPosition - selfPosition;
                        dist = length(dir);

                        if (dist < 0.0001 || dist > zoneRadius) continue;

                        distSquared = dist * dist;

                        if (distSquared > zoneRadiusSquared) continue;

                        percent = distSquared / zoneRadiusSquared;

                        if (percent < separationThresh) { // Separation
                            // Keep soft meditative distance - low separation force
                            f = (separationThresh / percent - 1.0) * delta;
                            velocity -= normalize(dir) * f;

                        } else if (percent < alignmentThresh) { // Alignment
                            // Strong alignment for V-formation feel
                            float threshDelta = alignmentThresh - separationThresh;
                            float adjustedPercent = (percent - separationThresh) / threshDelta;

                            birdVelocity = texture2D(textureVelocity, ref).xyz;

                            f = (0.5 - cos(adjustedPercent * PI_2) * 0.5 + 0.5) * delta;
                            velocity += normalize(birdVelocity) * f;

                        } else { // Cohesion
                            // Loose cohesion - drift together but not tight ball
                            float threshDelta = 1.0 - alignmentThresh;
                            float adjustedPercent = (percent - alignmentThresh) / threshDelta;

                            f = (0.5 - (cos(adjustedPercent * PI_2) * -0.5 + 0.5)) * delta;
                            velocity += normalize(dir) * f;
                        }
                    }
                }

                // Boundaries - huge range for "all over scene"
                if (selfPosition.x > 950.0) velocity.x -= 10.0 * delta;
                if (selfPosition.x < -950.0) velocity.x += 10.0 * delta;

                // Keep above trees but allow canopy skimming
                if (selfPosition.y > 380.0) velocity.y -= 6.0 * delta;
                if (selfPosition.y < 18.0) velocity.y += 8.0 * delta; // Avoid ground
                else if (selfPosition.y < 40.0) velocity.y += 1.5 * delta;

                // Allow flying behind camera (z > 0) and far into distance
                if (selfPosition.z > 400.0) velocity.z -= 10.0 * delta;
                if (selfPosition.z < -900.0) velocity.z += 10.0 * delta;

                // Encourage occasional low glides near canopy
                float canopyBand = smoothstep(35.0, 140.0, selfPosition.y);
                velocity.y -= canopyBand * 2.5 * delta;

                // Speed Limit
                velocity = normalize(velocity) * limit;

                gl_FragColor = vec4(velocity, 1.0);
            }
        `;

        this.birdVertexShader = `
            attribute vec2 reference;
            attribute float birdVertex;

            attribute vec3 birdColor;

            uniform sampler2D texturePosition;
            uniform sampler2D textureVelocity;

            varying vec4 vColor;
            varying float z;

            uniform float time;

            void main() {
                vec4 tmpPos = texture2D(texturePosition, reference);
                vec3 pos = tmpPos.xyz;
                vec3 velocity = normalize(texture2D(textureVelocity, reference).xyz);

                vec3 newPosition = position;

                if (birdVertex == 4.0 || birdVertex == 7.0) {
                    // flap wings based on phase + time
                    // Reduced flap speed for "meditative" feel
                    newPosition.y = sin(tmpPos.w + time * 5.0) * 0.8;
                }

                newPosition = mat3(modelMatrix) * newPosition;

                velocity.z *= -1.0;
                float xz = length(velocity.xz);
                float xyz = 1.0;
                float x = sqrt(1.0 - velocity.y * velocity.y);

                float cosry = velocity.x / xz;
                float sinry = velocity.z / xz;

                float cosrz = x / xyz;
                float sinrz = velocity.y / xyz;

                mat3 maty =  mat3(
                    cosry, 0, -sinry,
                    0    , 1, 0     ,
                    sinry, 0, cosry
                );

                mat3 matz =  mat3(
                    cosrz , sinrz, 0,
                    -sinrz, cosrz, 0,
                    0     , 0    , 1
                );

                newPosition =  maty * matz * newPosition;
                newPosition += pos;

                z = newPosition.z;

                vColor = vec4(birdColor, 1.0);
                gl_Position = projectionMatrix * viewMatrix * vec4(newPosition, 1.0);
            }
        `;

        this.birdFragmentShader = `
            varying vec4 vColor;
            varying float z;

            uniform vec3 color;

            void main() {
                // Dark silhouette birds with restrained distance haze.
                float distanceFade = smoothstep(-560.0, -140.0, z) * 0.09;
                vec3 base = mix(color, vColor.rgb, 0.25);
                vec3 finalColor = base + vec3(distanceFade * 0.7, distanceFade * 0.62, distanceFade * 0.52);
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;
    }

    init() {
        if (this.isWebGPU) {
            this.initWebGPUBirds();
            return;
        }
        this.initComputeRenderer();
        this.initBirdsWebGL();
    }

    createBirdBaseGeometry() {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            // Body triangle (local z is forward in the orientation shader).
            0.00, -0.03, -0.74, // 0 - tail
            0.00, 0.01, 0.86, // 1 - beak
            -0.12, 0.05, 0.08, // 2 - body shoulder

            // Left wing (swept silhouette).
            -0.08, 0.03, 0.10, // 3 - left wing root
            -1.30, 0.22, -0.06, // 4 - left wing tip (flaps)
            -0.24, -0.03, -0.24, // 5 - left trailing edge

            // Right wing (swept silhouette).
            0.08, 0.03, 0.10, // 6 - right wing root
            1.30, 0.22, -0.06, // 7 - right wing tip (flaps)
            0.24, -0.03, -0.24, // 8 - right trailing edge
        ]);

        for (let i = 0; i < vertices.length; i += 1) {
            vertices[i] *= 1.55;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        const normals = new Float32Array(vertices.length);
        for (let i = 0; i < normals.length; i += 3) {
            normals[i + 1] = 1.0;
        }
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.setAttribute('birdVertex', new THREE.BufferAttribute(new Float32Array([
            0, 1, 2,
            3, 4, 5,
            6, 7, 8,
        ]), 1));
        return geometry;
    }

    createWebGPUBirdMaterial() {
        const positionStorage = storage(this.birdCompute.getPositionBuffer(), 'vec4', this.BIRDS);
        const velocityStorage = storage(this.birdCompute.getVelocityBuffer(), 'vec4', this.BIRDS);
        const birdVertexAttr = attribute('birdVertex');
        const simTime = this.birdCompute.uTime;

        const posState = positionStorage.element(instanceIndex);
        const velState = velocityStorage.element(instanceIndex);

        const local = positionLocal;
        const leftWingMask = smoothstep(float(3.2), float(4.0), birdVertexAttr)
            .mul(float(1.0).sub(smoothstep(float(4.0), float(4.8), birdVertexAttr)));
        const rightWingMask = smoothstep(float(6.2), float(7.0), birdVertexAttr)
            .mul(float(1.0).sub(smoothstep(float(7.0), float(7.8), birdVertexAttr)));
        const wingMask = leftWingMask.add(rightWingMask);
        const flap = sin(posState.w.add(simTime.mul(5.0))).mul(0.8).mul(wingMask);
        const animatedLocal = vec3(local.x, local.y.add(flap), local.z);

        const flatVelocity = vec3(velState.x, float(0.0), velState.z);
        const xzSpeed = max(length(flatVelocity), float(0.0001));
        const forward = vec3(
            velState.x.div(xzSpeed),
            float(0.0),
            velState.z.div(xzSpeed),
        );
        const right = vec3(forward.z, float(0.0), forward.x.negate());
        const up = vec3(0.0, 1.0, 0.0);

        const oriented = right.mul(animatedLocal.x)
            .add(up.mul(animatedLocal.y))
            .add(forward.mul(animatedLocal.z));
        const worldPos = oriented.add(posState.xyz);

        const distanceFade = smoothstep(float(-560.0), float(-140.0), worldPos.z).mul(0.08);
        const baseColor = vec3(0.03, 0.015, 0.012);
        const finalColor = baseColor.add(vec3(
            distanceFade.mul(0.7),
            distanceFade.mul(0.62),
            distanceFade.mul(0.52),
        ));

        const material = new THREE_WEBGPU.MeshBasicNodeMaterial();
        material.side = THREE.DoubleSide;
        material.positionNode = worldPos;
        material.colorNode = finalColor;
        material.emissiveNode = finalColor.mul(0.01);
        return material;
    }

    initWebGPUBirds() {
        if (typeof this.renderer.compute !== 'function') {
            console.warn('[SwedishForestBirds] WebGPU renderer has no compute() API; skipping bird compute init.');
            return;
        }

        this.birdCompute = new SwedishForestBirdCompute(this.BIRDS, this.randomFn);
        this.birdCompute.setInitialState();
        this.birdCompute.createComputeNodes();

        const geometry = this.createBirdBaseGeometry();
        const material = this.createWebGPUBirdMaterial();

        this.mesh = new THREE.InstancedMesh(geometry, material, this.BIRDS);
        this.mesh.rotation.y = Math.PI / 2;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
        this.mesh.frustumCulled = false;

        const identity = new THREE.Matrix4();
        for (let i = 0; i < this.BIRDS; i += 1) {
            this.mesh.setMatrixAt(i, identity);
        }
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    initComputeRenderer() {
        this.gpuCompute = new GPUComputationRenderer(this.WIDTH, this.WIDTH, this.renderer);

        const dtPosition = this.gpuCompute.createTexture();
        const dtVelocity = this.gpuCompute.createTexture();

        this.fillTextures(dtPosition, dtVelocity);

        this.velocityVariable = this.gpuCompute.addVariable('textureVelocity', this.fragmentShaderVelocity, dtVelocity);
        this.positionVariable = this.gpuCompute.addVariable('texturePosition', this.fragmentShaderPosition, dtPosition);

        this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);
        this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);

        this.positionUniforms = this.positionVariable.material.uniforms;
        this.velocityUniforms = this.velocityVariable.material.uniforms;

        this.positionUniforms.time = { value: 0.0 };
        this.positionUniforms.delta = { value: 0.0 };
        this.velocityUniforms.time = { value: 1.0 };
        this.velocityUniforms.delta = { value: 0.0 };
        this.velocityUniforms.testing = { value: 1.0 };
        this.velocityUniforms.separationDistance = { value: 50.0 }; // Keep separation moderate
        this.velocityUniforms.alignmentDistance = { value: 70.0 }; // High alignment for formations
        this.velocityUniforms.cohesionDistance = { value: 70.0 }; // Gather from far away
        this.velocityUniforms.freedomFactor = { value: 0.75 };
        this.velocityUniforms.predator = { value: new THREE.Vector3() };
        this.velocityVariable.material.defines.BOUNDS = this.WIDTH.toFixed(1);

        this.velocityVariable.wrapS = THREE.RepeatWrapping;
        this.velocityVariable.wrapT = THREE.RepeatWrapping;
        this.positionVariable.wrapS = THREE.RepeatWrapping;
        this.positionVariable.wrapT = THREE.RepeatWrapping;

        const error = this.gpuCompute.init();
        if (error !== null) {
            console.error(error);
        }
    }

    initBirdsWebGL() {
        const geometry = this.createBirdBaseGeometry();

        const birdColor = new THREE.BufferAttribute(new Float32Array(this.BIRDS * 3 * 9), 3);
        const references = new THREE.BufferAttribute(new Float32Array(this.BIRDS * 2 * 9), 2);

        for (let i = 0; i < this.BIRDS; i += 1) {
            const x = (i % this.WIDTH) / this.WIDTH;
            const y = Math.floor(i / this.WIDTH) / this.WIDTH;
            const c = new THREE.Color(0x060302);

            for (let v = 0; v < 9; v += 1) {
                birdColor.array[i * 3 * 9 + v * 3 + 0] = c.r;
                birdColor.array[i * 3 * 9 + v * 3 + 1] = c.g;
                birdColor.array[i * 3 * 9 + v * 3 + 2] = c.b;

                references.array[i * 2 * 9 + v * 2 + 0] = x;
                references.array[i * 2 * 9 + v * 2 + 1] = y;
            }
        }

        const geometry2 = new THREE.InstancedBufferGeometry();
        geometry2.instanceCount = this.BIRDS;
        geometry2.setAttribute('position', geometry.getAttribute('position'));
        geometry2.setAttribute('birdVertex', geometry.getAttribute('birdVertex'));
        geometry2.setAttribute('reference', new THREE.InstancedBufferAttribute(references.array, 2));
        geometry2.setAttribute('birdColor', new THREE.InstancedBufferAttribute(birdColor.array, 3));

        const material = new THREE.ShaderMaterial({
            uniforms: {
                color: { value: new THREE.Color(0x040201) },
                texturePosition: { value: null },
                textureVelocity: { value: null },
                time: { value: 1.0 },
                delta: { value: 0.0 },
            },
            vertexShader: this.birdVertexShader,
            fragmentShader: this.birdFragmentShader,
            side: THREE.DoubleSide,
        });

        this.mesh = new THREE.Mesh(geometry2, material);
        this.mesh.rotation.y = Math.PI / 2;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.updateMatrix();
        this.mesh.frustumCulled = false;
    }

    fillTextures(texturePosition, textureVelocity) {
        const posArray = texturePosition.image.data;
        const velArray = textureVelocity.image.data;
        const random = this.randomFn;

        for (let k = 0, kl = posArray.length; k < kl; k += 4) {
            const x = random() * 2000 - 1000; // -1000 to 1000
            const nearCanopy = random() < 0.45;
            const y = nearCanopy
                ? 28 + random() * 30
                : 60 + random() * 160;
            const z = random() * 1200 - 800; // -800 to 400

            posArray[k + 0] = x;
            posArray[k + 1] = y;
            posArray[k + 2] = z;
            posArray[k + 3] = random(); // phase

            velArray[k + 0] = random() - 0.5;
            velArray[k + 1] = random() - 0.5;
            velArray[k + 2] = random() - 0.5;
            velArray[k + 3] = random() - 0.5;
        }
    }

    update(time, delta) {
        if (this.isWebGPU) {
            if (!this.birdCompute || typeof this.renderer.compute !== 'function') return;

            this.birdCompute.update(time, delta);
            if (this.birdCompute.updateVelocityNode) {
                this.renderer.compute(this.birdCompute.updateVelocityNode);
            }
            if (this.birdCompute.updatePositionNode) {
                this.renderer.compute(this.birdCompute.updatePositionNode);
            }
            return;
        }

        if (!this.gpuCompute) return;

        this.positionUniforms.time.value = time;
        this.positionUniforms.delta.value = delta;
        this.velocityUniforms.time.value = time;
        this.velocityUniforms.delta.value = delta;

        this.mesh.material.uniforms.time.value = time;
        this.mesh.material.uniforms.delta.value = delta;

        this.gpuCompute.compute();

        this.mesh.material.uniforms.texturePosition.value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
        this.mesh.material.uniforms.textureVelocity.value = this.gpuCompute.getCurrentRenderTarget(this.velocityVariable).texture;
    }

    dispose() {
        if (this.gpuCompute) {
            this.gpuCompute.dispose();
            this.gpuCompute = null;
        }

        if (this.birdCompute) {
            this.birdCompute.dispose();
            this.birdCompute = null;
        }

        if (this.mesh) {
            this.mesh.geometry?.dispose();
            this.mesh.material?.dispose();
            this.mesh = null;
        }

        this.positionVariable = null;
        this.velocityVariable = null;
        this.positionUniforms = null;
        this.velocityUniforms = null;
    }
}
