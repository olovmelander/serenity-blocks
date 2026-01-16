import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

export class SwedishForestBirds {
    constructor(renderer, scene) {
        this.renderer = renderer;
        this.scene = scene;
        this.birds = null;
        this.gpuCompute = null;

        // Configuration
        this.WIDTH = 32; // 32x32 = 1024 birds
        this.BIRDS = this.WIDTH * this.WIDTH;

        // Shaders
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
                // Keep birds as dark silhouettes with slight atmospheric fade
                float distanceFade = smoothstep(-520.0, -120.0, z) * 0.25;
                vec3 finalColor = mix(color, vColor.rgb, 0.1) + distanceFade;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `;
    }

    init() {
        this.initComputeRenderer();
        this.initBirds();
    }

    initComputeRenderer() {
        this.gpuCompute = new GPUComputationRenderer(this.WIDTH, this.WIDTH, this.renderer);

        const dtPosition = this.gpuCompute.createTexture();
        const dtVelocity = this.gpuCompute.createTexture();

        this.fillTextures(dtPosition, dtVelocity);

        this.velocityVariable = this.gpuCompute.addVariable("textureVelocity", this.fragmentShaderVelocity, dtVelocity);
        this.positionVariable = this.gpuCompute.addVariable("texturePosition", this.fragmentShaderPosition, dtPosition);

        this.gpuCompute.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]);
        this.gpuCompute.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]);

        this.positionUniforms = this.positionVariable.material.uniforms;
        this.velocityUniforms = this.velocityVariable.material.uniforms;

        this.positionUniforms["time"] = { value: 0.0 };
        this.positionUniforms["delta"] = { value: 0.0 };
        this.velocityUniforms["time"] = { value: 1.0 };
        this.velocityUniforms["delta"] = { value: 0.0 };
        this.velocityUniforms["testing"] = { value: 1.0 };
        this.velocityUniforms["separationDistance"] = { value: 50.0 }; // Keep separation moderate
        this.velocityUniforms["alignmentDistance"] = { value: 70.0 }; // High alignment for formations
        this.velocityUniforms["cohesionDistance"] = { value: 70.0 }; // Gather from far away
        this.velocityUniforms["freedomFactor"] = { value: 0.75 };
        this.velocityUniforms["predator"] = { value: new THREE.Vector3() };
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

    initBirds() {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([
            // Body - simple thin triangle
            0.5, -0.0, 0.0, // 0 - tail
            -0.5, -0.0, 0.0, // 1 - head
            0.0, 0.0, 0.5, // 2 - spine low (width)

            // Wings
            0.0, 0.0, -0.5, // 3 - spine top
            0.0, 2.0, -0.5, // 4 - wing tip left
            0.0, 0.0, 0.5, // 5 - spine low (width)

            0.0, 0.0, 0.5, // 6 - spine low
            0.0, 2.0, 0.5, // 7 - wing tip right
            0.0, 0.0, -0.5  // 8 - spine top
        ]);

        // Just use a simple V shape
        // 0--1
        //  \/

        // Simple 3-tri geometry
        //     4   7
        //     | \ / |
        //     |  3  |
        //     | / \ |
        //     1     0

        // Scale birds
        for (let i = 0; i < vertices.length; i++) {
            vertices[i] *= 1.8; // Slightly larger silhouette for visibility
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        geometry.setAttribute('birdVertex', new THREE.BufferAttribute(new Float32Array([
            0, 1, 2,
            3, 4, 5,
            6, 7, 8
        ]), 1));

        const birdColor = new THREE.BufferAttribute(new Float32Array(this.BIRDS * 3), 3);
        const references = new THREE.BufferAttribute(new Float32Array(this.BIRDS * 2), 2);
        const birdVertex = geometry.getAttribute('birdVertex');

        for (let i = 0; i < this.BIRDS; i++) {
            const x = (i % this.WIDTH) / this.WIDTH;
            const y = ~~(i / this.WIDTH) / this.WIDTH;

            // Dark silhouette colors
            const c = new THREE.Color(0x0C0504);

            for (let v = 0; v < 9; v++) {
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
                color: { value: new THREE.Color(0x050202) },
                texturePosition: { value: null },
                textureVelocity: { value: null },
                time: { value: 1.0 },
                delta: { value: 0.0 }
            },
            vertexShader: this.birdVertexShader,
            fragmentShader: this.birdFragmentShader,
            side: THREE.DoubleSide
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

        for (let k = 0, kl = posArray.length; k < kl; k += 4) {
            // Random start positions everywhere!
            const x = Math.random() * 2000 - 1000; // -1000 to 1000
            const nearCanopy = Math.random() < 0.45;
            const y = nearCanopy
                ? 28 + Math.random() * 30   // Glide close to treetops
                : 60 + Math.random() * 160; // Higher soaring
            const z = Math.random() * 1200 - 800;  // -800 to 400

            posArray[k + 0] = x;
            posArray[k + 1] = y;
            posArray[k + 2] = z;
            posArray[k + 3] = Math.random(); // Phase

            // Slow drift velocity
            velArray[k + 0] = Math.random() - 0.5;
            velArray[k + 1] = Math.random() - 0.5;
            velArray[k + 2] = Math.random() - 0.5;
            velArray[k + 3] = Math.random() - 0.5;
        }
    }

    update(time, delta) {
        if (!this.gpuCompute) return;

        this.positionUniforms["time"].value = time;
        this.positionUniforms["delta"].value = delta;
        this.velocityUniforms["time"].value = time;
        this.velocityUniforms["delta"].value = delta;

        this.mesh.material.uniforms["time"].value = time;
        this.mesh.material.uniforms["delta"].value = delta;

        this.gpuCompute.compute();

        this.mesh.material.uniforms["texturePosition"].value = this.gpuCompute.getCurrentRenderTarget(this.positionVariable).texture;
        this.mesh.material.uniforms["textureVelocity"].value = this.gpuCompute.getCurrentRenderTarget(this.velocityVariable).texture;
    }
}
