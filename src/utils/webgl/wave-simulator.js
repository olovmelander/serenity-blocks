/**
 * WaveSimulator - WebGL-based water wave simulation
 *
 * Physics: Shallow Water Equations with surface tension
 * - Simpler and faster than full Navier-Stokes
 * - Specialized for water surface waves
 * - Realistic ripples, swells, and foam
 *
 * Key Features:
 * - Height field simulation with gravity + surface tension
 * - Multiple wave types (ripples, swells, chop)
 * - Wind forcing system
 * - Foam generation at wave crests
 * - Caustics projection (underwater light patterns)
 * - Normal mapping for 3D appearance
 * - Quality presets for performance scaling
 *
 * Usage:
 *   const simulator = new WaveSimulator(canvas, config);
 *   await simulator.init();
 *   // Animation loop
 *   simulator.step(deltaTime);
 *   simulator.render();
 *   // Interactions
 *   simulator.createRipple(x, y, { radius: 0.05, amplitude: 0.3 });
 */

export default class WaveSimulator {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.config = {
            // Wave Physics
            WAVE_RESOLUTION: 256,
            NORMAL_RESOLUTION: 512,
            DISPLACEMENT_SCALE: 1.0,
            WAVE_SPEED: 1.5,
            WAVE_DAMPING: 0.995,
            SURFACE_TENSION: 0.01,
            GRAVITY: 9.8,

            // Wind System
            WIND_DIRECTION: [1.0, 0.0],
            WIND_STRENGTH: 2.0,
            WIND_GUSTINESS: 0.3,
            WIND_COHERENCE: 0.7,

            // Wave Types
            SWELL_ENABLED: true,
            SWELL_FREQUENCY: 0.5,
            SWELL_AMPLITUDE: 2.0,
            RIPPLE_ENABLED: true,
            RIPPLE_FREQUENCY: 5.0,
            RIPPLE_AMPLITUDE: 0.3,
            CHOP_ENABLED: true,
            CHOP_FREQUENCY: 2.0,
            CHOP_AMPLITUDE: 1.0,

            // Visual Effects
            FOAM_ENABLED: true,
            FOAM_THRESHOLD: 0.4,
            FOAM_DECAY: 0.98,
            FOAM_COVERAGE: 0.3,
            CAUSTICS_ENABLED: true,
            CAUSTICS_INTENSITY: 0.6,
            CAUSTICS_SCALE: 2.0,
            REFRACTION_ENABLED: true,
            REFRACTION_STRENGTH: 0.1,
            REFLECTION_ENABLED: true,
            REFLECTION_BLUR: 0.2,

            // Colors
            WATER_COLOR: { r: 0.1, g: 0.3, b: 0.5 },
            FOAM_COLOR: { r: 0.9, g: 0.95, b: 1.0 },
            DEEP_COLOR: { r: 0.05, g: 0.15, b: 0.3 },

            // Performance
            TRANSPARENT: false,
            ...config
        };

        this.gl = null;
        this.ext = null;
        this.programs = {};

        // Simulation state
        this.height = null;      // Wave height field (double-buffered)
        this.velocity = null;    // Vertical velocity (double-buffered)
        this.foam = null;        // Foam density (double-buffered)
        this.normals = null;     // Surface normals (single buffer)
        this.caustics = null;    // Caustic pattern (single buffer)

        // Blit geometry (reused for all draw calls)
        this.blitBuffer = null;
        this.blitElementBuffer = null;
    }

    async init() {
        const { gl, ext } = this.getWebGLContext(this.canvas);
        this.gl = gl;
        this.ext = ext;

        if (!ext.supportLinearFiltering) {
            this.config.NORMAL_RESOLUTION = 256;
            this.config.CAUSTICS_ENABLED = false;
        }

        // Compile shaders
        this.initPrograms();

        // Initialize framebuffers
        this.initFramebuffers();

        console.log('[WaveSimulator] Initialized successfully');
        return true;
    }

    getWebGLContext(canvas) {
        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false
        };

        let gl = canvas.getContext('webgl2', params);
        const isWebGL2 = !!gl;
        if (!isWebGL2) {
            gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
        }

        let halfFloat;
        let supportLinearFiltering;
        if (isWebGL2) {
            gl.getExtension('EXT_color_buffer_float');
            supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
        } else {
            halfFloat = gl.getExtension('OES_texture_half_float');
            supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
        }

        gl.clearColor(0.0, 0.0, 0.0, 1.0);

        const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
        let formatRGBA;
        let formatRG;
        let formatR;

        if (isWebGL2) {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
        } else {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        }

        return {
            gl,
            ext: {
                formatRGBA,
                formatRG,
                formatR,
                halfFloatTexType,
                supportLinearFiltering
            }
        };
    }

    getSupportedFormat(gl, internalFormat, format, type) {
        if (!this.supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
                case gl.R16F:
                    return this.getSupportedFormat(gl, gl.RG16F, gl.RG, type);
                case gl.RG16F:
                    return this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
                default:
                    return null;
            }
        }

        return {
            internalFormat,
            format
        };
    }

    supportRenderTextureFormat(gl, internalFormat, format, type) {
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        return status == gl.FRAMEBUFFER_COMPLETE;
    }

    compileShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('[WaveSimulator] Shader compilation error:', gl.getShaderInfoLog(shader));
        }

        return shader;
    }

    initPrograms() {
        const gl = this.gl;

        // Base vertex shader for full-screen quad with neighbor coordinates
        const baseVertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform vec2 texelSize;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                vL = vUv - vec2(texelSize.x, 0.0);
                vR = vUv + vec2(texelSize.x, 0.0);
                vT = vUv + vec2(0.0, texelSize.y);
                vB = vUv - vec2(0.0, texelSize.y);
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        // Wave height update shader
        const waveHeightShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uHeight;
            uniform sampler2D uVelocity;
            uniform float dt;
            void main() {
                float height = texture2D(uHeight, vUv).r;
                float velocity = texture2D(uVelocity, vUv).r;
                float newHeight = height + velocity * dt;
                gl_FragColor = vec4(newHeight, 0.0, 0.0, 1.0);
            }
        `;

        // Wave velocity update shader (shallow water equations)
        const waveVelocityShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uHeight;
            uniform sampler2D uVelocity;
            uniform float dt;
            uniform float gravity;
            uniform float damping;
            uniform float surfaceTension;
            void main() {
                float heightC = texture2D(uHeight, vUv).r;
                float heightL = texture2D(uHeight, vL).r;
                float heightR = texture2D(uHeight, vR).r;
                float heightT = texture2D(uHeight, vT).r;
                float heightB = texture2D(uHeight, vB).r;
                float velocity = texture2D(uVelocity, vUv).r;

                // Gradient (restoring force from gravity)
                float divergence = (heightR - heightL + heightT - heightB) * 0.5;
                float gravityForce = -gravity * divergence;

                // Laplacian (surface tension for small ripples)
                float laplacian = heightL + heightR + heightT + heightB - 4.0 * heightC;
                float capillaryForce = surfaceTension * laplacian;

                // Update velocity
                float newVelocity = velocity + (gravityForce + capillaryForce) * dt;
                newVelocity *= damping;

                gl_FragColor = vec4(newVelocity, 0.0, 0.0, 1.0);
            }
        `;

        // Wave displacement shader (add ripple/swell)
        const waveDisplacementShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uHeight;
            uniform vec2 point;
            uniform float radius;
            uniform float amplitude;
            uniform float aspectRatio;
            void main() {
                float height = texture2D(uHeight, vUv).r;
                vec2 p = vUv - point;
                p.x *= aspectRatio;
                float dist = length(p);
                float displacement = exp(-dist * dist / (radius * radius)) * amplitude;
                gl_FragColor = vec4(height + displacement, 0.0, 0.0, 1.0);
            }
        `;

        // Normal map generation from height field
        const waveNormalShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uHeight;
            uniform float displacementScale;
            void main() {
                float heightL = texture2D(uHeight, vL).r;
                float heightR = texture2D(uHeight, vR).r;
                float heightT = texture2D(uHeight, vT).r;
                float heightB = texture2D(uHeight, vB).r;

                // Compute gradients
                float dx = (heightR - heightL) * displacementScale;
                float dy = (heightT - heightB) * displacementScale;

                // Normalize to create normal vector
                vec3 normal = normalize(vec3(-dx, -dy, 1.0));

                // Encode normal in [0,1] range for storage
                normal = normal * 0.5 + 0.5;

                gl_FragColor = vec4(normal, 1.0);
            }
        `;

        // Foam generation shader (based on wave curvature)
        const waveFoamShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uHeight;
            uniform sampler2D uFoam;
            uniform float threshold;
            uniform float decay;
            void main() {
                float heightC = texture2D(uHeight, vUv).r;
                float heightL = texture2D(uHeight, vL).r;
                float heightR = texture2D(uHeight, vR).r;
                float heightT = texture2D(uHeight, vT).r;
                float heightB = texture2D(uHeight, vB).r;

                // Compute curvature (second derivative)
                float laplacian = abs(heightL + heightR + heightT + heightB - 4.0 * heightC);

                // Generate foam where curvature is high (breaking waves)
                float newFoam = step(threshold, laplacian);

                // Combine with existing foam and apply decay
                float existingFoam = texture2D(uFoam, vUv).r;
                float foam = max(newFoam, existingFoam * decay);

                gl_FragColor = vec4(foam, 0.0, 0.0, 1.0);
            }
        `;

        // Caustics projection shader
        const waveCausticsShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uNormals;
            uniform float intensity;
            uniform float scale;
            void main() {
                // Sample normal map
                vec3 normal = texture2D(uNormals, vUv).rgb * 2.0 - 1.0;

                // Refract light direction based on normal
                vec3 lightDir = vec3(0.0, 0.0, 1.0);
                vec3 refracted = refract(lightDir, normal, 0.75); // Water IOR ~1.33

                // Project to caustic pattern
                vec2 causticUV = vUv + refracted.xy * scale;

                // Sample caustic intensity (use normal variation as proxy)
                float caustic = abs(normal.x * normal.y) * intensity;

                gl_FragColor = vec4(vec3(caustic), 1.0);
            }
        `;

        // Final display shader
        const waveDisplayShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uHeight;
            uniform sampler2D uNormals;
            uniform sampler2D uFoam;
            uniform sampler2D uCaustics;
            uniform vec3 waterColor;
            uniform vec3 foamColor;
            uniform vec3 deepColor;
            uniform float displacementScale;
            uniform bool foamEnabled;
            uniform bool causticsEnabled;
            void main() {
                // Sample textures
                float height = texture2D(uHeight, vUv).r;
                vec3 normal = texture2D(uNormals, vUv).rgb * 2.0 - 1.0;
                float foam = foamEnabled ? texture2D(uFoam, vUv).r : 0.0;
                float caustic = causticsEnabled ? texture2D(uCaustics, vUv).r : 0.0;

                // Lighting (simple diffuse from above)
                vec3 lightDir = normalize(vec3(0.3, 0.3, 1.0));
                float diffuse = max(dot(normal, lightDir), 0.0) * 0.5 + 0.5;

                // Depth-based color (deeper = darker)
                float depth = clamp(-height * displacementScale, 0.0, 1.0);
                vec3 color = mix(waterColor, deepColor, depth);

                // Apply lighting
                color *= diffuse;

                // Add caustics (brighten shallow areas)
                color += caustic * (1.0 - depth);

                // Mix in foam at wave crests
                color = mix(color, foamColor, foam);

                // Add specular highlight
                vec3 viewDir = vec3(0.0, 0.0, 1.0);
                vec3 halfDir = normalize(lightDir + viewDir);
                float specular = pow(max(dot(normal, halfDir), 0.0), 32.0);
                color += specular * 0.3;

                gl_FragColor = vec4(color, 1.0);
            }
        `;

        // Copy shader for utility operations
        const copyShaderSource = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            void main() {
                gl_FragColor = texture2D(uTexture, vUv);
            }
        `;

        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, baseVertexShaderSource);

        this.programs.waveHeight = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveHeightShaderSource));
        this.programs.waveVelocity = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveVelocityShaderSource));
        this.programs.waveDisplacement = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveDisplacementShaderSource));
        this.programs.waveNormal = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveNormalShaderSource));
        this.programs.waveFoam = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveFoamShaderSource));
        this.programs.waveCaustics = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveCausticsShaderSource));
        this.programs.waveDisplay = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, waveDisplayShaderSource));
        this.programs.copy = new Program(gl, baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, copyShaderSource));
    }

    initFramebuffers() {
        const gl = this.gl;
        const ext = this.ext;

        let waveRes = this.getResolution(this.config.WAVE_RESOLUTION);
        let normalRes = this.getResolution(this.config.NORMAL_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const r = ext.formatR;
        const rgb = ext.formatRGBA;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        gl.disable(gl.BLEND);

        // Height field (stores wave displacement)
        this.height = this.createDoubleFBO(
            waveRes.width, waveRes.height,
            r.internalFormat, r.format, texType, filtering
        );

        // Velocity field (stores vertical velocity)
        this.velocity = this.createDoubleFBO(
            waveRes.width, waveRes.height,
            r.internalFormat, r.format, texType, filtering
        );

        // Foam field
        if (this.config.FOAM_ENABLED) {
            this.foam = this.createDoubleFBO(
                waveRes.width, waveRes.height,
                r.internalFormat, r.format, texType, filtering
            );
        }

        // Normal map
        this.normals = this.createFBO(
            normalRes.width, normalRes.height,
            rgb.internalFormat, rgb.format, texType, filtering
        );

        // Caustics
        if (this.config.CAUSTICS_ENABLED) {
            this.caustics = this.createFBO(
                normalRes.width, normalRes.height,
                r.internalFormat, r.format, texType, filtering
            );
        }
    }

    createFBO(w, h, internalFormat, format, type, param) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        let texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        let fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let texelSizeX = 1.0 / w;
        let texelSizeY = 1.0 / h;

        return {
            texture,
            fbo,
            width: w,
            height: h,
            texelSizeX,
            texelSizeY,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);

        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            get read() {
                return fbo1;
            },
            set read(value) {
                fbo1 = value;
            },
            get write() {
                return fbo2;
            },
            set write(value) {
                fbo2 = value;
            },
            swap() {
                let temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            }
        };
    }

    getResolution(resolution) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1)
            aspectRatio = 1.0 / aspectRatio;

        let min = Math.round(resolution);
        let max = Math.round(resolution * aspectRatio);

        if (this.canvas.width > this.canvas.height)
            return { width: max, height: min };
        else
            return { width: min, height: max };
    }

    blit(target, clear = false) {
        const gl = this.gl;

        // Init blit geometry if needed
        if (!this.blitBuffer) {
            this.blitBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.blitBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            this.blitElementBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blitElementBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.blitBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blitElementBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        if (target == null) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }

        if (clear) {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    /**
     * Advance wave simulation by dt seconds
     */
    step(dt) {
        const gl = this.gl;
        const config = this.config;

        // Cap time step to prevent instability
        dt = Math.min(dt, 0.016);

        // Update velocity from height gradients
        this.programs.waveVelocity.bind();
        gl.uniform2f(this.programs.waveVelocity.uniforms.texelSize,
            this.height.texelSizeX, this.height.texelSizeY);
        gl.uniform1i(this.programs.waveVelocity.uniforms.uHeight, this.height.read.attach(0));
        gl.uniform1i(this.programs.waveVelocity.uniforms.uVelocity, this.velocity.read.attach(1));
        gl.uniform1f(this.programs.waveVelocity.uniforms.dt, dt);
        gl.uniform1f(this.programs.waveVelocity.uniforms.gravity, config.GRAVITY);
        gl.uniform1f(this.programs.waveVelocity.uniforms.damping, config.WAVE_DAMPING);
        gl.uniform1f(this.programs.waveVelocity.uniforms.surfaceTension, config.SURFACE_TENSION);
        this.blit(this.velocity.write);
        this.velocity.swap();

        // Update height from velocity
        this.programs.waveHeight.bind();
        gl.uniform1i(this.programs.waveHeight.uniforms.uHeight, this.height.read.attach(0));
        gl.uniform1i(this.programs.waveHeight.uniforms.uVelocity, this.velocity.read.attach(1));
        gl.uniform1f(this.programs.waveHeight.uniforms.dt, dt);
        this.blit(this.height.write);
        this.height.swap();

        // Generate normals from height field
        this.programs.waveNormal.bind();
        gl.uniform2f(this.programs.waveNormal.uniforms.texelSize,
            this.height.texelSizeX, this.height.texelSizeY);
        gl.uniform1i(this.programs.waveNormal.uniforms.uHeight, this.height.read.attach(0));
        gl.uniform1f(this.programs.waveNormal.uniforms.displacementScale, config.DISPLACEMENT_SCALE);
        this.blit(this.normals);

        // Update foam
        if (config.FOAM_ENABLED && this.foam) {
            this.programs.waveFoam.bind();
            gl.uniform2f(this.programs.waveFoam.uniforms.texelSize,
                this.height.texelSizeX, this.height.texelSizeY);
            gl.uniform1i(this.programs.waveFoam.uniforms.uHeight, this.height.read.attach(0));
            gl.uniform1i(this.programs.waveFoam.uniforms.uFoam, this.foam.read.attach(1));
            gl.uniform1f(this.programs.waveFoam.uniforms.threshold, config.FOAM_THRESHOLD);
            gl.uniform1f(this.programs.waveFoam.uniforms.decay, config.FOAM_DECAY);
            this.blit(this.foam.write);
            this.foam.swap();
        }

        // Generate caustics
        if (config.CAUSTICS_ENABLED && this.caustics) {
            this.programs.waveCaustics.bind();
            gl.uniform1i(this.programs.waveCaustics.uniforms.uNormals, this.normals.attach(0));
            gl.uniform1f(this.programs.waveCaustics.uniforms.intensity, config.CAUSTICS_INTENSITY);
            gl.uniform1f(this.programs.waveCaustics.uniforms.scale, config.CAUSTICS_SCALE);
            this.blit(this.caustics);
        }
    }

    /**
     * Render waves to target (or screen if null)
     */
    render(target = null) {
        const gl = this.gl;
        const config = this.config;

        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);

        this.programs.waveDisplay.bind();
        gl.uniform1i(this.programs.waveDisplay.uniforms.uHeight, this.height.read.attach(0));
        gl.uniform1i(this.programs.waveDisplay.uniforms.uNormals, this.normals.attach(1));

        if (config.FOAM_ENABLED && this.foam) {
            gl.uniform1i(this.programs.waveDisplay.uniforms.uFoam, this.foam.read.attach(2));
            gl.uniform1i(this.programs.waveDisplay.uniforms.foamEnabled, true);
        } else {
            gl.uniform1i(this.programs.waveDisplay.uniforms.foamEnabled, false);
        }

        if (config.CAUSTICS_ENABLED && this.caustics) {
            gl.uniform1i(this.programs.waveDisplay.uniforms.uCaustics, this.caustics.attach(3));
            gl.uniform1i(this.programs.waveDisplay.uniforms.causticsEnabled, true);
        } else {
            gl.uniform1i(this.programs.waveDisplay.uniforms.causticsEnabled, false);
        }

        gl.uniform3f(this.programs.waveDisplay.uniforms.waterColor,
            config.WATER_COLOR.r, config.WATER_COLOR.g, config.WATER_COLOR.b);
        gl.uniform3f(this.programs.waveDisplay.uniforms.foamColor,
            config.FOAM_COLOR.r, config.FOAM_COLOR.g, config.FOAM_COLOR.b);
        gl.uniform3f(this.programs.waveDisplay.uniforms.deepColor,
            config.DEEP_COLOR.r, config.DEEP_COLOR.g, config.DEEP_COLOR.b);
        gl.uniform1f(this.programs.waveDisplay.uniforms.displacementScale, config.DISPLACEMENT_SCALE);

        this.blit(target);
    }

    /**
     * Create a ripple at normalized position (x, y in [0, 1])
     */
    createRipple(x, y, options = {}) {
        const config = {
            radius: 0.05,
            amplitude: 0.3,
            ...options
        };

        const gl = this.gl;
        this.programs.waveDisplacement.bind();
        gl.uniform1i(this.programs.waveDisplacement.uniforms.uHeight, this.height.read.attach(0));
        gl.uniform2f(this.programs.waveDisplacement.uniforms.point, x, y);
        gl.uniform1f(this.programs.waveDisplacement.uniforms.radius, config.radius);
        gl.uniform1f(this.programs.waveDisplacement.uniforms.amplitude, config.amplitude);
        gl.uniform1f(this.programs.waveDisplacement.uniforms.aspectRatio,
            this.canvas.width / this.canvas.height);
        this.blit(this.height.write);
        this.height.swap();
    }

    /**
     * Create a large rolling swell
     */
    createSwell(x, y, options = {}) {
        const config = {
            radius: 0.3,
            amplitude: 2.0,
            ...options
        };
        this.createRipple(x, y, config);
    }

    /**
     * Set wind direction and strength
     */
    setWind(direction, strength) {
        this.config.WIND_DIRECTION = direction;
        this.config.WIND_STRENGTH = strength;
    }

    /**
     * Handle canvas resize
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.initFramebuffers();
    }

    /**
     * Update configuration at runtime
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.initFramebuffers();
    }

    /**
     * Clear all wave state - resets ocean to calm
     */
    clear() {
        if (!this.gl || !this.height || !this.velocity) return;

        const gl = this.gl;
        
        // Clear height field
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.height.read.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.height.write.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Clear velocity field
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.read.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.write.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        
        // Clear foam field if enabled
        if (this.config.FOAM_ENABLED && this.foam) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.foam.read.fbo);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.foam.write.fbo);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        
        // Unbind framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        
        console.log('[WaveSimulator] Wave state cleared - ocean calm');
    }

    /**
     * Cleanup WebGL resources
     */
    cleanup() {
        // TODO: Properly cleanup textures, FBOs, shaders, buffers
        console.log('[WaveSimulator] Cleanup called');
    }
}

/**
 * Shader Program wrapper (same pattern as FluidSimulator)
 */
class Program {
    constructor(gl, vertexShader, fragmentShader) {
        this.gl = gl;
        this.uniforms = {};
        this.program = this.createProgram(vertexShader, fragmentShader);
        this.uniforms = this.getUniforms(this.program);
    }

    bind() {
        this.gl.useProgram(this.program);
    }

    createProgram(vertexShader, fragmentShader) {
        const gl = this.gl;
        let program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('[WaveSimulator] Program link error:', gl.getProgramInfoLog(program));
        }

        return program;
    }

    getUniforms(program) {
        const gl = this.gl;
        let uniforms = {};
        let uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            let uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }
        return uniforms;
    }
}

/**
 * Quality presets for performance scaling
 */
export const WAVE_QUALITY_PRESETS = {
    low: {
        WAVE_RESOLUTION: 128,
        NORMAL_RESOLUTION: 256,
        FOAM_ENABLED: false,
        CAUSTICS_ENABLED: false,
        REFLECTION_ENABLED: false
    },
    medium: {
        WAVE_RESOLUTION: 256,
        NORMAL_RESOLUTION: 512,
        FOAM_ENABLED: true,
        CAUSTICS_ENABLED: false,
        REFLECTION_ENABLED: false
    },
    high: {
        WAVE_RESOLUTION: 384,
        NORMAL_RESOLUTION: 768,
        FOAM_ENABLED: true,
        CAUSTICS_ENABLED: true,
        REFLECTION_ENABLED: true
    },
    ultra: {
        WAVE_RESOLUTION: 512,
        NORMAL_RESOLUTION: 1024,
        FOAM_ENABLED: true,
        CAUSTICS_ENABLED: true,
        REFLECTION_ENABLED: true
    }
};
