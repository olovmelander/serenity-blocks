/**
 * PlasmaSimulator - WebGL-based electromagnetic plasma simulation
 *
 * Physics: Simplified Maxwell equations for electromagnetic waves
 * - Charge density field (scalar field similar to wave height)
 * - Current field (vector field similar to fluid velocity)
 * - Energy density field (controls color and glow)
 * - Plasma oscillations and electromagnetic wave propagation
 *
 * Key Features:
 * - Electromagnetic field simulation
 * - Multi-frequency plasma oscillations
 * - Charge accumulation and discharge
 * - Energy flow and advection (fluid-like)
 * - Dynamic filament/tendril generation
 * - Temperature-based color mapping
 * - Glow and emission effects
 * - Turbulent electromagnetic fields
 *
 * Visual Style:
 * - Cosmic plasma effects
 * - Aurora-like energy flows
 * - Electric arc patterns
 * - Volumetric glow
 *
 * Usage:
 *   const simulator = new PlasmaSimulator(canvas, config);
 *   await simulator.init();
 *   // Animation loop
 *   simulator.step(deltaTime);
 *   simulator.render();
 *   // Interactions
 *   simulator.addEnergyBurst(x, y, { intensity: 0.8, radius: 0.1 });
 */

export default class PlasmaSimulator {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.config = {
            // Simulation Resolution
            CHARGE_RESOLUTION: 256,
            ENERGY_RESOLUTION: 512,

            // Electromagnetic Physics
            WAVE_SPEED: 2.0, // Electromagnetic wave propagation speed
            CHARGE_COUPLING: 0.85, // How strongly charge affects current
            CURRENT_DAMPING: 0.992, // Energy dissipation in current field
            CHARGE_DAMPING: 0.998, // Energy dissipation in charge field
            PLASMA_FREQUENCY: 3.0, // Natural oscillation frequency

            // Energy Flow
            ENERGY_ADVECTION: 0.7, // How much energy flows with current
            ENERGY_DIFFUSION: 0.02, // Energy spreading
            ENERGY_DECAY: 0.995, // Energy dissipation rate
            ENERGY_GENERATION: 0.3, // Energy created from charge gradients

            // Turbulence and Chaos
            TURBULENCE: 0.5, // Electromagnetic turbulence strength
            CHAOS_FREQUENCY: 1.5, // Small-scale chaotic fluctuations
            VORTICITY: 15.0, // Swirling motion in current field

            // Filament Generation
            FILAMENT_ENABLED: true,
            FILAMENT_THRESHOLD: 0.5, // Charge gradient needed for filaments
            FILAMENT_INTENSITY: 0.8, // Filament brightness
            FILAMENT_DECAY: 0.96, // How quickly filaments fade

            // Visual Effects
            GLOW_ENABLED: true,
            GLOW_INTENSITY: 0.7,
            GLOW_RADIUS: 2.5,
            BLOOM_ENABLED: true,
            BLOOM_INTENSITY: 0.6,

            // Color Mapping (plasma temperature)
            COLOR_MODE: 'cosmic', // 'cosmic', 'fire', 'electric', 'aurora'
            COLOR_SHIFT_SPEED: 0.5, // How fast colors cycle
            MIN_COLOR: { r: 0.1, g: 0.0, b: 0.3 }, // Low energy (deep violet)
            MID_COLOR: { r: 0.0, g: 0.5, b: 0.8 }, // Mid energy (cyan)
            MAX_COLOR: { r: 0.3, g: 1.0, b: 0.9 }, // High energy (bright cyan-white)

            // External Forces
            MAGNETIC_FIELD: [0.0, 0.0], // External magnetic field
            ELECTRIC_FIELD: [0.0, 0.0], // External electric field

            // Performance
            TRANSPARENT: false,
            ...config,
        };

        this.gl = null;
        this.ext = null;
        this.programs = {};

        // Simulation state
        this.charge = null; // Charge density field (double-buffered)
        this.current = null; // Current/flow field (double-buffered)
        this.energy = null; // Energy density field (double-buffered)
        this.filaments = null; // Filament/arc patterns (single buffer)
        this.glow = null; // Glow/emission (single buffer)

        // Rendering
        this.blitBuffer = null;
        this.blitElementBuffer = null;

        // Time tracking for oscillations
        this.time = 0;
    }

    async init() {
        const { gl, ext } = this.getWebGLContext(this.canvas);
        this.gl = gl;
        this.ext = ext;

        if (!ext.supportLinearFiltering) {
            this.config.ENERGY_RESOLUTION = 256;
            this.config.GLOW_ENABLED = false;
        }

        // Compile shaders
        this.initPrograms();

        // Initialize framebuffers
        this.initFramebuffers();

        console.log('[PlasmaSimulator] Initialized successfully');
        return true;
    }

    getWebGLContext(canvas) {
        const params = {
            alpha: true,
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false,
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
                supportLinearFiltering,
            },
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
            format,
        };
    }

    supportRenderTextureFormat(gl, internalFormat, format, type) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        return status == gl.FRAMEBUFFER_COMPLETE;
    }

    compileShader(type, source) {
        const { gl } = this;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('[PlasmaSimulator] Shader compilation error:', gl.getShaderInfoLog(shader));
        }

        return shader;
    }

    initPrograms() {
        const { gl } = this;

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

        // Current field update (electromagnetic force from charge field)
        const currentUpdateShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uCharge;
            uniform sampler2D uCurrent;
            uniform float dt;
            uniform float coupling;
            uniform float damping;
            uniform float plasmaFreq;
            uniform vec2 externalField;
            void main() {
                // Sample charge gradients (creates electric field)
                float chargeC = texture2D(uCharge, vUv).r;
                float chargeL = texture2D(uCharge, vL).r;
                float chargeR = texture2D(uCharge, vR).r;
                float chargeT = texture2D(uCharge, vT).r;
                float chargeB = texture2D(uCharge, vB).r;

                // Calculate electric field (gradient of charge)
                vec2 electricField = vec2(chargeR - chargeL, chargeT - chargeB) * 0.5;

                // Current acceleration from electric field (Lorentz force)
                vec2 current = texture2D(uCurrent, vUv).rg;
                vec2 force = -electricField * coupling;

                // Add external electromagnetic field
                force += externalField;

                // Plasma oscillation (natural frequency)
                force -= current * plasmaFreq * dt;

                // Update current
                vec2 newCurrent = current + force * dt;
                newCurrent *= damping;

                gl_FragColor = vec4(newCurrent, 0.0, 1.0);
            }
        `;

        // Charge field update (wave propagation from current divergence)
        const chargeUpdateShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uCharge;
            uniform sampler2D uCurrent;
            uniform float dt;
            uniform float waveSpeed;
            uniform float damping;
            void main() {
                float charge = texture2D(uCharge, vUv).r;

                // Sample current field
                vec2 currentL = texture2D(uCurrent, vL).rg;
                vec2 currentR = texture2D(uCurrent, vR).rg;
                vec2 currentT = texture2D(uCurrent, vT).rg;
                vec2 currentB = texture2D(uCurrent, vB).rg;

                // Calculate current divergence (charge conservation)
                float divergence = (currentR.x - currentL.x + currentT.y - currentB.y) * 0.5;

                // Update charge based on current flow
                float newCharge = charge - divergence * waveSpeed * dt;
                newCharge *= damping;

                gl_FragColor = vec4(newCharge, 0.0, 0.0, 1.0);
            }
        `;

        // Vorticity calculation (curl of current field for turbulence)
        const vorticityShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uCurrent;
            uniform sampler2D uCharge;
            uniform float vorticity;
            uniform float dt;
            void main() {
                vec2 currentL = texture2D(uCurrent, vL).rg;
                vec2 currentR = texture2D(uCurrent, vR).rg;
                vec2 currentT = texture2D(uCurrent, vT).rg;
                vec2 currentB = texture2D(uCurrent, vB).rg;
                vec2 current = texture2D(uCurrent, vUv).rg;

                // Calculate curl (vorticity)
                float curl = currentR.y - currentL.y - currentT.x + currentB.x;

                // Apply vorticity confinement force
                vec2 force = vec2(abs(currentT.y) - abs(currentB.y), abs(currentR.x) - abs(currentL.x)) * 0.5;
                float lengthSq = max(0.0001, dot(force, force));
                force = force * inversesqrt(lengthSq) * curl * vorticity;

                vec2 newCurrent = current + force * dt;
                gl_FragColor = vec4(newCurrent, 0.0, 1.0);
            }
        `;

        // Energy advection (energy flows with current)
        const energyAdvectionShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uEnergy;
            uniform sampler2D uCurrent;
            uniform sampler2D uCharge;
            uniform vec2 texelSize;
            uniform float dt;
            uniform float advection;
            uniform float diffusion;
            uniform float decay;
            uniform float generation;
            void main() {
                vec2 current = texture2D(uCurrent, vUv).rg;

                // Advect energy along current flow
                vec2 coord = vUv - dt * current * texelSize * advection;
                float energy = texture2D(uEnergy, coord).r;

                // Energy diffusion
                float energyL = texture2D(uEnergy, vL).r;
                float energyR = texture2D(uEnergy, vR).r;
                float energyT = texture2D(uEnergy, vT).r;
                float energyB = texture2D(uEnergy, vB).r;
                float laplacian = (energyL + energyR + energyT + energyB - 4.0 * energy);
                energy += laplacian * diffusion;

                // Generate energy from charge gradients (electromagnetic work)
                float chargeC = texture2D(uCharge, vUv).r;
                float chargeL = texture2D(uCharge, vL).r;
                float chargeR = texture2D(uCharge, vR).r;
                float chargeT = texture2D(uCharge, vT).r;
                float chargeB = texture2D(uCharge, vB).r;
                float chargeGradient = abs(chargeR - chargeL) + abs(chargeT - chargeB);
                energy += chargeGradient * generation * dt;

                // Energy decay
                energy *= decay;

                gl_FragColor = vec4(energy, 0.0, 0.0, 1.0);
            }
        `;

        // Filament generation (electric arc patterns from high charge gradients)
        const filamentShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uCharge;
            uniform sampler2D uFilaments;
            uniform float threshold;
            uniform float intensity;
            uniform float decay;
            void main() {
                float chargeC = texture2D(uCharge, vUv).r;
                float chargeL = texture2D(uCharge, vL).r;
                float chargeR = texture2D(uCharge, vR).r;
                float chargeT = texture2D(uCharge, vT).r;
                float chargeB = texture2D(uCharge, vB).r;

                // Calculate charge gradient magnitude
                float gradX = chargeR - chargeL;
                float gradY = chargeT - chargeB;
                float gradientMag = length(vec2(gradX, gradY));

                // Generate filament where gradient is high
                float newFilament = smoothstep(threshold, threshold + 0.3, gradientMag) * intensity;

                // Combine with existing filaments (with decay)
                float existingFilament = texture2D(uFilaments, vUv).r;
                float filament = max(newFilament, existingFilament * decay);

                gl_FragColor = vec4(filament, 0.0, 0.0, 1.0);
            }
        `;

        // Glow generation (emission from energy density)
        const glowShaderSource = `
            precision highp float;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uEnergy;
            uniform sampler2D uFilaments;
            uniform float intensity;
            uniform float radius;
            void main() {
                float energy = texture2D(uEnergy, vUv).r;
                float filament = texture2D(uFilaments, vUv).r;

                // Sample neighbors for blur/glow effect
                float energyL = texture2D(uEnergy, vL).r;
                float energyR = texture2D(uEnergy, vR).r;
                float energyT = texture2D(uEnergy, vT).r;
                float energyB = texture2D(uEnergy, vB).r;

                // Blur
                float glow = (energy + energyL + energyR + energyT + energyB) * 0.2;

                // Boost by filaments
                glow += filament * 0.5;

                glow *= intensity;

                gl_FragColor = vec4(glow, 0.0, 0.0, 1.0);
            }
        `;

        // Energy burst (add energy impulse)
        const energyBurstShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uEnergy;
            uniform vec2 point;
            uniform float radius;
            uniform float intensity;
            uniform float aspectRatio;
            void main() {
                float energy = texture2D(uEnergy, vUv).r;
                vec2 p = vUv - point;
                p.x *= aspectRatio;
                float dist = length(p);
                float burst = exp(-dist * dist / (radius * radius)) * intensity;
                gl_FragColor = vec4(energy + burst, 0.0, 0.0, 1.0);
            }
        `;

        // Charge burst (add charge impulse)
        const chargeBurstShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uCharge;
            uniform vec2 point;
            uniform float radius;
            uniform float intensity;
            uniform float aspectRatio;
            void main() {
                float charge = texture2D(uCharge, vUv).r;
                vec2 p = vUv - point;
                p.x *= aspectRatio;
                float dist = length(p);
                float burst = exp(-dist * dist / (radius * radius)) * intensity;
                gl_FragColor = vec4(charge + burst, 0.0, 0.0, 1.0);
            }
        `;

        // Final plasma display shader
        const plasmaDisplayShaderSource = `
            precision highp float;
            varying vec2 vUv;
            uniform sampler2D uCharge;
            uniform sampler2D uEnergy;
            uniform sampler2D uFilaments;
            uniform sampler2D uGlow;
            uniform vec3 minColor;
            uniform vec3 midColor;
            uniform vec3 maxColor;
            uniform float time;
            uniform float colorShiftSpeed;
            uniform bool glowEnabled;
            uniform bool filamentEnabled;

            vec3 plasmaColor(float energy, float charge) {
                // Map energy to color (temperature-like gradient)
                float t = clamp(energy, 0.0, 1.0);

                // Three-point gradient
                vec3 color;
                if (t < 0.5) {
                    color = mix(minColor, midColor, t * 2.0);
                } else {
                    color = mix(midColor, maxColor, (t - 0.5) * 2.0);
                }

                // Add slight color shifting based on charge
                float hueShift = sin(time * colorShiftSpeed + charge * 10.0) * 0.1;
                color.r += hueShift;
                color.b -= hueShift * 0.5;

                return color;
            }

            void main() {
                float charge = texture2D(uCharge, vUv).r;
                float energy = texture2D(uEnergy, vUv).r;
                float filament = filamentEnabled ? texture2D(uFilaments, vUv).r : 0.0;
                float glow = glowEnabled ? texture2D(uGlow, vUv).r : 0.0;

                // Base plasma color
                vec3 color = plasmaColor(energy, charge);

                // Boost brightness with energy
                color *= (0.5 + energy * 1.5);

                // Add filament contribution (bright electric arcs)
                color += filament * vec3(0.9, 1.0, 1.0);

                // Add glow/emission
                color += glow * 0.5;

                // Ensure minimum visibility
                color = max(color, vec3(0.05));

                gl_FragColor = vec4(color, 1.0);
            }
        `;

        // Copy shader
        const copyShaderSource = `
            precision mediump float;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            void main() {
                gl_FragColor = texture2D(uTexture, vUv);
            }
        `;

        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, baseVertexShaderSource);

        this.programs.currentUpdate = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, currentUpdateShaderSource),
        );
        this.programs.chargeUpdate = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, chargeUpdateShaderSource),
        );
        this.programs.vorticity = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, vorticityShaderSource),
        );
        this.programs.energyAdvection = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, energyAdvectionShaderSource),
        );
        this.programs.filament = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, filamentShaderSource),
        );
        this.programs.glow = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, glowShaderSource),
        );
        this.programs.energyBurst = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, energyBurstShaderSource),
        );
        this.programs.chargeBurst = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, chargeBurstShaderSource),
        );
        this.programs.plasmaDisplay = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, plasmaDisplayShaderSource),
        );
        this.programs.copy = new Program(
            gl,
            baseVertexShader,
            this.compileShader(gl.FRAGMENT_SHADER, copyShaderSource),
        );
    }

    initFramebuffers() {
        const { gl } = this;
        const { ext } = this;

        const chargeRes = this.getResolution(this.config.CHARGE_RESOLUTION);
        const energyRes = this.getResolution(this.config.ENERGY_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const r = ext.formatR;
        const rg = ext.formatRG;
        const rgb = ext.formatRGBA;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        gl.disable(gl.BLEND);

        // Charge density field
        this.charge = this.createDoubleFBO(
            chargeRes.width,
            chargeRes.height,
            r.internalFormat,
            r.format,
            texType,
            filtering,
        );

        // Current field (2D vector)
        this.current = this.createDoubleFBO(
            chargeRes.width,
            chargeRes.height,
            rg.internalFormat,
            rg.format,
            texType,
            filtering,
        );

        // Energy density field
        this.energy = this.createDoubleFBO(
            energyRes.width,
            energyRes.height,
            r.internalFormat,
            r.format,
            texType,
            filtering,
        );

        // Filaments
        if (this.config.FILAMENT_ENABLED) {
            this.filaments = this.createDoubleFBO(
                energyRes.width,
                energyRes.height,
                r.internalFormat,
                r.format,
                texType,
                filtering,
            );
        }

        // Glow
        if (this.config.GLOW_ENABLED) {
            this.glow = this.createFBO(
                energyRes.width,
                energyRes.height,
                r.internalFormat,
                r.format,
                texType,
                filtering,
            );
        }
    }

    createFBO(w, h, internalFormat, format, type, param) {
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const texelSizeX = 1.0 / w;
        const texelSizeY = 1.0 / h;

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
            },
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
                const temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            },
        };
    }

    getResolution(resolution) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;

        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);

        if (this.canvas.width > this.canvas.height) return { width: max, height: min };
        return { width: min, height: max };
    }

    blit(target, clear = false) {
        const { gl } = this;

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
     * Advance plasma simulation by dt seconds
     */
    step(dt) {
        const { gl } = this;
        const { config } = this;

        // Update time for color shifting
        this.time += dt;

        // Cap time step to prevent instability
        dt = Math.min(dt, 0.016);

        gl.disable(gl.BLEND);

        // Step 1: Apply vorticity confinement to current (turbulence)
        if (config.VORTICITY > 0) {
            this.programs.vorticity.bind();
            gl.uniform2f(
                this.programs.vorticity.uniforms.texelSize,
                this.current.texelSizeX,
                this.current.texelSizeY,
            );
            gl.uniform1i(this.programs.vorticity.uniforms.uCurrent, this.current.read.attach(0));
            gl.uniform1i(this.programs.vorticity.uniforms.uCharge, this.charge.read.attach(1));
            gl.uniform1f(this.programs.vorticity.uniforms.vorticity, config.VORTICITY);
            gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
            this.blit(this.current.write);
            this.current.swap();
        }

        // Step 2: Update current from electromagnetic forces
        this.programs.currentUpdate.bind();
        gl.uniform2f(
            this.programs.currentUpdate.uniforms.texelSize,
            this.charge.texelSizeX,
            this.charge.texelSizeY,
        );
        gl.uniform1i(this.programs.currentUpdate.uniforms.uCharge, this.charge.read.attach(0));
        gl.uniform1i(this.programs.currentUpdate.uniforms.uCurrent, this.current.read.attach(1));
        gl.uniform1f(this.programs.currentUpdate.uniforms.dt, dt);
        gl.uniform1f(this.programs.currentUpdate.uniforms.coupling, config.CHARGE_COUPLING);
        gl.uniform1f(this.programs.currentUpdate.uniforms.damping, config.CURRENT_DAMPING);
        gl.uniform1f(this.programs.currentUpdate.uniforms.plasmaFreq, config.PLASMA_FREQUENCY);
        gl.uniform2f(
            this.programs.currentUpdate.uniforms.externalField,
            config.ELECTRIC_FIELD[0],
            config.ELECTRIC_FIELD[1],
        );
        this.blit(this.current.write);
        this.current.swap();

        // Step 3: Update charge from current divergence (wave propagation)
        this.programs.chargeUpdate.bind();
        gl.uniform2f(
            this.programs.chargeUpdate.uniforms.texelSize,
            this.charge.texelSizeX,
            this.charge.texelSizeY,
        );
        gl.uniform1i(this.programs.chargeUpdate.uniforms.uCharge, this.charge.read.attach(0));
        gl.uniform1i(this.programs.chargeUpdate.uniforms.uCurrent, this.current.read.attach(1));
        gl.uniform1f(this.programs.chargeUpdate.uniforms.dt, dt);
        gl.uniform1f(this.programs.chargeUpdate.uniforms.waveSpeed, config.WAVE_SPEED);
        gl.uniform1f(this.programs.chargeUpdate.uniforms.damping, config.CHARGE_DAMPING);
        this.blit(this.charge.write);
        this.charge.swap();

        // Step 4: Advect energy along current flow
        this.programs.energyAdvection.bind();
        gl.uniform2f(
            this.programs.energyAdvection.uniforms.texelSize,
            this.energy.texelSizeX,
            this.energy.texelSizeY,
        );
        gl.uniform1i(this.programs.energyAdvection.uniforms.uEnergy, this.energy.read.attach(0));
        gl.uniform1i(this.programs.energyAdvection.uniforms.uCurrent, this.current.read.attach(1));
        gl.uniform1i(this.programs.energyAdvection.uniforms.uCharge, this.charge.read.attach(2));
        gl.uniform1f(this.programs.energyAdvection.uniforms.dt, dt);
        gl.uniform1f(this.programs.energyAdvection.uniforms.advection, config.ENERGY_ADVECTION);
        gl.uniform1f(this.programs.energyAdvection.uniforms.diffusion, config.ENERGY_DIFFUSION);
        gl.uniform1f(this.programs.energyAdvection.uniforms.decay, config.ENERGY_DECAY);
        gl.uniform1f(this.programs.energyAdvection.uniforms.generation, config.ENERGY_GENERATION);
        this.blit(this.energy.write);
        this.energy.swap();

        // Step 5: Generate filaments from charge gradients
        if (config.FILAMENT_ENABLED && this.filaments) {
            this.programs.filament.bind();
            gl.uniform2f(
                this.programs.filament.uniforms.texelSize,
                this.charge.texelSizeX,
                this.charge.texelSizeY,
            );
            gl.uniform1i(this.programs.filament.uniforms.uCharge, this.charge.read.attach(0));
            gl.uniform1i(this.programs.filament.uniforms.uFilaments, this.filaments.read.attach(1));
            gl.uniform1f(this.programs.filament.uniforms.threshold, config.FILAMENT_THRESHOLD);
            gl.uniform1f(this.programs.filament.uniforms.intensity, config.FILAMENT_INTENSITY);
            gl.uniform1f(this.programs.filament.uniforms.decay, config.FILAMENT_DECAY);
            this.blit(this.filaments.write);
            this.filaments.swap();
        }

        // Step 6: Generate glow from energy
        if (config.GLOW_ENABLED && this.glow) {
            this.programs.glow.bind();
            gl.uniform2f(
                this.programs.glow.uniforms.texelSize,
                this.energy.texelSizeX,
                this.energy.texelSizeY,
            );
            gl.uniform1i(this.programs.glow.uniforms.uEnergy, this.energy.read.attach(0));
            gl.uniform1i(
                this.programs.glow.uniforms.uFilaments,
                this.filaments ? this.filaments.read.attach(1) : this.energy.read.attach(1),
            );
            gl.uniform1f(this.programs.glow.uniforms.intensity, config.GLOW_INTENSITY);
            gl.uniform1f(this.programs.glow.uniforms.radius, config.GLOW_RADIUS);
            this.blit(this.glow);
        }
    }

    /**
     * Render plasma to target (or screen if null)
     */
    render(target = null) {
        const { gl } = this;
        const { config } = this;

        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);

        this.programs.plasmaDisplay.bind();
        gl.uniform1i(this.programs.plasmaDisplay.uniforms.uCharge, this.charge.read.attach(0));
        gl.uniform1i(this.programs.plasmaDisplay.uniforms.uEnergy, this.energy.read.attach(1));

        if (config.FILAMENT_ENABLED && this.filaments) {
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.uFilaments, this.filaments.read.attach(2));
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.filamentEnabled, true);
        } else {
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.filamentEnabled, false);
        }

        if (config.GLOW_ENABLED && this.glow) {
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.uGlow, this.glow.attach(3));
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.glowEnabled, true);
        } else {
            gl.uniform1i(this.programs.plasmaDisplay.uniforms.glowEnabled, false);
        }

        gl.uniform3f(
            this.programs.plasmaDisplay.uniforms.minColor,
            config.MIN_COLOR.r,
            config.MIN_COLOR.g,
            config.MIN_COLOR.b,
        );
        gl.uniform3f(
            this.programs.plasmaDisplay.uniforms.midColor,
            config.MID_COLOR.r,
            config.MID_COLOR.g,
            config.MID_COLOR.b,
        );
        gl.uniform3f(
            this.programs.plasmaDisplay.uniforms.maxColor,
            config.MAX_COLOR.r,
            config.MAX_COLOR.g,
            config.MAX_COLOR.b,
        );
        gl.uniform1f(this.programs.plasmaDisplay.uniforms.time, this.time);
        gl.uniform1f(this.programs.plasmaDisplay.uniforms.colorShiftSpeed, config.COLOR_SHIFT_SPEED);

        this.blit(target);
    }

    /**
     * Add energy burst at normalized position (x, y in [0, 1])
     */
    addEnergyBurst(x, y, options = {}) {
        const config = {
            radius: 0.08,
            intensity: 0.8,
            chargeIntensity: 0.5,
            ...options,
        };

        const { gl } = this;

        // Add energy
        this.programs.energyBurst.bind();
        gl.uniform1i(this.programs.energyBurst.uniforms.uEnergy, this.energy.read.attach(0));
        gl.uniform2f(this.programs.energyBurst.uniforms.point, x, y);
        gl.uniform1f(this.programs.energyBurst.uniforms.radius, config.radius);
        gl.uniform1f(this.programs.energyBurst.uniforms.intensity, config.intensity);
        gl.uniform1f(
            this.programs.energyBurst.uniforms.aspectRatio,
            this.canvas.width / this.canvas.height,
        );
        this.blit(this.energy.write);
        this.energy.swap();

        // Add charge (creates electromagnetic waves)
        this.programs.chargeBurst.bind();
        gl.uniform1i(this.programs.chargeBurst.uniforms.uCharge, this.charge.read.attach(0));
        gl.uniform2f(this.programs.chargeBurst.uniforms.point, x, y);
        gl.uniform1f(this.programs.chargeBurst.uniforms.radius, config.radius);
        gl.uniform1f(this.programs.chargeBurst.uniforms.intensity, config.chargeIntensity);
        gl.uniform1f(
            this.programs.chargeBurst.uniforms.aspectRatio,
            this.canvas.width / this.canvas.height,
        );
        this.blit(this.charge.write);
        this.charge.swap();
    }

    /**
     * Set external electromagnetic field
     */
    setElectromagneticField(direction, strength) {
        this.config.ELECTRIC_FIELD = [
            direction[0] * strength,
            direction[1] * strength,
        ];
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
     * Clear all plasma state - reset to calm
     */
    clear() {
        if (!this.gl || !this.charge || !this.current || !this.energy) return;

        const { gl } = this;

        // Clear charge field
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.charge.read.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.charge.write.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Clear current field
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.current.read.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.current.write.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Clear energy field
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.energy.read.fbo);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.energy.write.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Clear filaments if enabled
        if (this.config.FILAMENT_ENABLED && this.filaments) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.filaments.read.fbo);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.filaments.write.fbo);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        // Unbind framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        console.log('[PlasmaSimulator] Plasma state cleared - calm');
    }

    /**
     * Cleanup WebGL resources
     */
    cleanup() {
        // TODO: Properly cleanup textures, FBOs, shaders, buffers
        console.log('[PlasmaSimulator] Cleanup called');
    }
}

/**
 * Shader Program wrapper
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
        const { gl } = this;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('[PlasmaSimulator] Program link error:', gl.getProgramInfoLog(program));
        }

        return program;
    }

    getUniforms(program) {
        const { gl } = this;
        const uniforms = {};
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }
        return uniforms;
    }
}

/**
 * Quality presets for performance scaling
 */
export const PLASMA_QUALITY_PRESETS = {
    low: {
        CHARGE_RESOLUTION: 128,
        ENERGY_RESOLUTION: 256,
        FILAMENT_ENABLED: false,
        GLOW_ENABLED: false,
        VORTICITY: 5.0,
    },
    medium: {
        CHARGE_RESOLUTION: 256,
        ENERGY_RESOLUTION: 512,
        FILAMENT_ENABLED: true,
        GLOW_ENABLED: false,
        VORTICITY: 15.0,
    },
    high: {
        CHARGE_RESOLUTION: 384,
        ENERGY_RESOLUTION: 768,
        FILAMENT_ENABLED: true,
        GLOW_ENABLED: true,
        VORTICITY: 20.0,
    },
    ultra: {
        CHARGE_RESOLUTION: 512,
        ENERGY_RESOLUTION: 1024,
        FILAMENT_ENABLED: true,
        GLOW_ENABLED: true,
        VORTICITY: 30.0,
    },
};

/**
 * Color mode presets
 */
export const PLASMA_COLOR_MODES = {
    cosmic: {
        MIN_COLOR: { r: 0.1, g: 0.0, b: 0.3 }, // Deep violet
        MID_COLOR: { r: 0.0, g: 0.5, b: 0.8 }, // Cyan
        MAX_COLOR: { r: 0.3, g: 1.0, b: 0.9 }, // Bright cyan-white
    },
    fire: {
        MIN_COLOR: { r: 0.2, g: 0.0, b: 0.0 }, // Deep red
        MID_COLOR: { r: 1.0, g: 0.3, b: 0.0 }, // Orange
        MAX_COLOR: { r: 1.0, g: 1.0, b: 0.8 }, // Bright yellow-white
    },
    electric: {
        MIN_COLOR: { r: 0.0, g: 0.0, b: 0.3 }, // Deep blue
        MID_COLOR: { r: 0.3, g: 0.3, b: 1.0 }, // Electric blue
        MAX_COLOR: { r: 0.9, g: 0.9, b: 1.0 }, // Bright white-blue
    },
    aurora: {
        MIN_COLOR: { r: 0.0, g: 0.2, b: 0.3 }, // Deep teal
        MID_COLOR: { r: 0.2, g: 0.8, b: 0.5 }, // Green
        MAX_COLOR: { r: 0.8, g: 1.0, b: 0.9 }, // Bright green-white
    },
    nebula: {
        MIN_COLOR: { r: 0.3, g: 0.0, b: 0.3 }, // Magenta
        MID_COLOR: { r: 0.5, g: 0.2, b: 0.8 }, // Purple
        MAX_COLOR: { r: 0.9, g: 0.7, b: 1.0 }, // Bright lavender
    },
};
