/**
 * FluidSimulator - GPU-accelerated fluid dynamics simulation using WebGL
 *
 * Implements a simplified Navier-Stokes solver for 2D incompressible flow:
 * 1. Advection - move fields along velocity
 * 2. Pressure solve - enforce incompressibility
 * 3. Pressure gradient - correct velocity field
 * 4. Dye advection - move colors
 *
 * Based on GPU Gems Chapter 38 and Jos Stam's "Stable Fluids"
 */

// Inline shaders (Vite ?raw imports causing issues)
const baseVertShader = `
attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
    v_texCoord = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const advectionFragShader = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_velocity;
uniform sampler2D u_source;
uniform vec2 u_texelSize;
uniform float u_dt;
uniform float u_dissipation;
void main() {
    vec2 coord = v_texCoord - u_dt * texture2D(u_velocity, v_texCoord).xy * u_texelSize;
    vec4 result = texture2D(u_source, coord);
    gl_FragColor = u_dissipation * result;
}`;

const divergenceFragShader = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_velocity;
uniform vec2 u_texelSize;
void main() {
    float L = texture2D(u_velocity, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture2D(u_velocity, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture2D(u_velocity, v_texCoord + vec2(0.0, u_texelSize.y)).y;
    float B = texture2D(u_velocity, v_texCoord - vec2(0.0, u_texelSize.y)).y;
    float divergence = 0.5 * (R - L + T - B);
    gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
}`;

const pressureFragShader = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_pressure;
uniform sampler2D u_divergence;
uniform vec2 u_texelSize;
void main() {
    float L = texture2D(u_pressure, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture2D(u_pressure, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture2D(u_pressure, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_texCoord - vec2(0.0, u_texelSize.y)).x;
    float divergence = texture2D(u_divergence, v_texCoord).x;
    float pressure = (L + R + T + B - divergence) * 0.25;
    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}`;

const gradientFragShader = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_velocity;
uniform sampler2D u_pressure;
uniform vec2 u_texelSize;
void main() {
    float L = texture2D(u_pressure, v_texCoord - vec2(u_texelSize.x, 0.0)).x;
    float R = texture2D(u_pressure, v_texCoord + vec2(u_texelSize.x, 0.0)).x;
    float T = texture2D(u_pressure, v_texCoord + vec2(0.0, u_texelSize.y)).x;
    float B = texture2D(u_pressure, v_texCoord - vec2(0.0, u_texelSize.y)).x;
    vec2 gradient = 0.5 * vec2(R - L, T - B);
    vec2 velocity = texture2D(u_velocity, v_texCoord).xy;
    velocity -= gradient;
    gl_FragColor = vec4(velocity, 0.0, 1.0);
}`;

const displayFragShader = `
precision highp float;
varying vec2 v_texCoord;
uniform sampler2D u_dye;
uniform float u_bloomIntensity;
void main() {
    vec4 color = texture2D(u_dye, v_texCoord);

    // Gentle brightness boost for visibility
    color.rgb *= 1.4;

    // Soft bloom effect
    float bloom = u_bloomIntensity;
    if (bloom > 0.0) {
        float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        vec3 softGlow = mix(color.rgb, vec3(brightness), 0.3);
        float blend = min(1.0, bloom * 0.7);
        color.rgb = mix(color.rgb, softGlow, blend);
        color.rgb += vec3(brightness) * bloom * 0.03;
    }

    // Clamp to prevent white flickering
    color.rgb = clamp(color.rgb, 0.0, 0.85);

    gl_FragColor = vec4(color.rgb, 1.0);
}`;

export default class FluidSimulator {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.config = {
            simResolution: config.simResolution || 128,
            dyeResolution: config.dyeResolution || 512,
            pressureIterations: config.pressureIterations || 3,
            velocityDissipation: config.velocityDissipation || 0.98,
            densityDissipation: config.densityDissipation || 0.99,
            splatRadius: config.splatRadius || 0.25,
            splatForce: config.splatForce || 6000,
            bloomIntensity: config.bloomIntensity || 0.3,
            timeScale: typeof config.timeScale === 'number' ? config.timeScale : 1.0,
        };

        this.gl = null;
        this.programs = {};
        this.fbos = {};
        this.isInitialized = false;
    }

    /**
     * Initialize WebGL context and compile shaders
     */
    async init() {
        console.log('[FluidSimulator] Initializing...');
        console.log('[FluidSimulator] Canvas size:', this.canvas.width, 'x', this.canvas.height);

        // Get WebGL context
        this.gl = this.canvas.getContext('webgl', {
            alpha: false,
            depth: false,
            stencil: false,
            antialias: false,
            preserveDrawingBuffer: false,
        });

        if (!this.gl) {
            console.error('[FluidSimulator] WebGL not supported');
            return false;
        }

        console.log('[FluidSimulator] WebGL context created');

        const gl = this.gl;

        // Enable required extensions
        const ext = gl.getExtension('OES_texture_half_float');
        const extLinear = gl.getExtension('OES_texture_half_float_linear');

        if (!ext) {
            console.warn('OES_texture_half_float not supported, using FLOAT');
        }

        // Compile all shader programs
        console.log('[FluidSimulator] Compiling shaders...');
        try {
            this.programs.advection = this.createProgram(baseVertShader, advectionFragShader);
            console.log('[FluidSimulator] - Advection shader compiled');
            this.programs.divergence = this.createProgram(baseVertShader, divergenceFragShader);
            console.log('[FluidSimulator] - Divergence shader compiled');
            this.programs.pressure = this.createProgram(baseVertShader, pressureFragShader);
            console.log('[FluidSimulator] - Pressure shader compiled');
            this.programs.gradient = this.createProgram(baseVertShader, gradientFragShader);
            console.log('[FluidSimulator] - Gradient shader compiled');
            this.programs.display = this.createProgram(baseVertShader, displayFragShader);
            console.log('[FluidSimulator] - Display shader compiled');
        } catch (error) {
            console.error('[FluidSimulator] Failed to compile shaders:', error);
            return false;
        }

        // Create fullscreen quad geometry
        this.createQuadGeometry();

        // Create frame buffer objects
        const simRes = this.config.simResolution;
        const dyeRes = this.config.dyeResolution;

        this.fbos.velocity = this.createDoubleFBO(simRes, simRes, gl.RG || gl.RGBA, gl.RG || gl.RGBA, ext ? ext.HALF_FLOAT_OES : gl.FLOAT);
        this.fbos.pressure = this.createDoubleFBO(simRes, simRes, gl.RGBA, gl.RGBA, ext ? ext.HALF_FLOAT_OES : gl.FLOAT);
        this.fbos.divergence = this.createFBO(simRes, simRes, gl.RGBA, gl.RGBA, ext ? ext.HALF_FLOAT_OES : gl.FLOAT);
        this.fbos.dye = this.createDoubleFBO(dyeRes, dyeRes, gl.RGBA, gl.RGBA, ext ? ext.HALF_FLOAT_OES : gl.FLOAT);

        console.log('[FluidSimulator] FBOs created successfully');

        // Clear canvas to show initialization worked
        gl.clearColor(0.05, 0.05, 0.15, 1.0); // Dark blue
        gl.clear(gl.COLOR_BUFFER_BIT);

        this.isInitialized = true;
        console.log('[FluidSimulator] Initialization complete!');
        return true;
    }

    /**
     * Create and compile a shader program
     */
    createProgram(vertSource, fragSource) {
        const gl = this.gl;

        const vertShader = this.compileShader(vertSource, gl.VERTEX_SHADER);
        const fragShader = this.compileShader(fragSource, gl.FRAGMENT_SHADER);

        if (!vertShader || !fragShader) {
            throw new Error('Shader compilation failed');
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(program);
            throw new Error('Program linking failed: ' + info);
        }

        // Cache uniform locations
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        const uniforms = {};

        for (let i = 0; i < uniformCount; i++) {
            const uniformInfo = gl.getActiveUniform(program, i);
            uniforms[uniformInfo.name] = gl.getUniformLocation(program, uniformInfo.name);
        }

        return { program, uniforms };
    }

    /**
     * Compile a shader
     */
    compileShader(source, type) {
        const gl = this.gl;
        const shader = gl.createShader(type);

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            console.error('Shader compilation error:', info);
            gl.deleteShader(shader);
            return null;
        }

        return shader;
    }

    /**
     * Create fullscreen quad geometry
     */
    createQuadGeometry() {
        const gl = this.gl;

        // Fullscreen quad vertices [-1, 1]
        const vertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);

        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    }

    /**
     * Create a single frame buffer object
     */
    createFBO(width, height, internalFormat, format, type) {
        const gl = this.gl;

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error('Framebuffer incomplete:', status);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return { fbo, texture, width, height };
    }

    /**
     * Create double-buffered FBO for ping-pong rendering
     */
    createDoubleFBO(width, height, internalFormat, format, type) {
        return {
            read: this.createFBO(width, height, internalFormat, format, type),
            write: this.createFBO(width, height, internalFormat, format, type),
            swap() {
                const temp = this.read;
                this.read = this.write;
                this.write = temp;
            }
        };
    }

    /**
     * Render to a target FBO using a shader program
     */
    render(target, program) {
        const gl = this.gl;

        // Bind target framebuffer
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);

        // Set viewport
        if (target) {
            gl.viewport(0, 0, target.width, target.height);
        } else {
            gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        }

        // Use program
        gl.useProgram(program.program);

        // Bind quad geometry
        const posLoc = gl.getAttribLocation(program.program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        // Draw
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    /**
     * Run one simulation step
     */
    step(deltaTime) {
        if (!this.isInitialized) return;

        const gl = this.gl;
        const cappedDelta = Math.min(deltaTime, 16.67);
        const dt = (cappedDelta / 1000) * this.config.timeScale; // Cap at 60 FPS, scale for smoother motion

        // 1. Advect velocity
        this.advect(this.fbos.velocity, this.fbos.velocity.read, dt, this.config.velocityDissipation);

        // 2. Compute divergence
        this.computeDivergence(this.fbos.velocity, this.fbos.divergence);

        // 3. Solve pressure (multiple iterations for accuracy)
        this.clearFBO(this.fbos.pressure.read);
        for (let i = 0; i < this.config.pressureIterations; i++) {
            this.solvePressure(this.fbos.pressure, this.fbos.divergence);
        }

        // 4. Subtract pressure gradient from velocity
        this.subtractGradient(this.fbos.velocity, this.fbos.pressure.read);

        // 5. Advect dye/color
        this.advect(this.fbos.dye, this.fbos.velocity.read, dt, this.config.densityDissipation);

        // 6. Render to canvas
        this.display();
    }

    /**
     * Advection step
     * @param {Object} target - Double FBO to advect (read from target.read, write to target.write)
     * @param {Object} velocity - Single FBO containing velocity field
     * @param {number} dt - Time step
     * @param {number} dissipation - Dissipation factor
     */
    advect(target, velocity, dt, dissipation) {
        const gl = this.gl;
        const program = this.programs.advection;

        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform1i(program.uniforms.u_velocity, 0);
        gl.uniform1i(program.uniforms.u_source, 1);
        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / velocity.width, 1.0 / velocity.height);
        gl.uniform1f(program.uniforms.u_dt, dt);
        gl.uniform1f(program.uniforms.u_dissipation, dissipation);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, target.read.texture);

        // Render
        this.render(target.write, program);
        target.swap();
    }

    /**
     * Compute velocity divergence
     */
    computeDivergence(velocity, divergence) {
        const gl = this.gl;
        const program = this.programs.divergence;

        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform1i(program.uniforms.u_velocity, 0);
        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / velocity.read.width, 1.0 / velocity.read.height);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);

        // Render
        this.render(divergence, program);
    }

    /**
     * Solve pressure using Jacobi iteration
     */
    solvePressure(pressure, divergence) {
        const gl = this.gl;
        const program = this.programs.pressure;

        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform1i(program.uniforms.u_pressure, 0);
        gl.uniform1i(program.uniforms.u_divergence, 1);
        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / pressure.read.width, 1.0 / pressure.read.height);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pressure.read.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, divergence.texture);

        // Render
        this.render(pressure.write, program);
        pressure.swap();
    }

    /**
     * Subtract pressure gradient from velocity
     */
    subtractGradient(velocity, pressure) {
        const gl = this.gl;
        const program = this.programs.gradient;

        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform1i(program.uniforms.u_velocity, 0);
        gl.uniform1i(program.uniforms.u_pressure, 1);
        gl.uniform2f(program.uniforms.u_texelSize, 1.0 / velocity.read.width, 1.0 / velocity.read.height);

        // Bind textures
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, velocity.read.texture);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, pressure.texture);

        // Render
        this.render(velocity.write, program);
        velocity.swap();
    }

    /**
     * Display dye field to canvas
     */
    display() {
        const gl = this.gl;
        const program = this.programs.display;

        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform1i(program.uniforms.u_dye, 0);
        gl.uniform1f(program.uniforms.u_bloomIntensity, this.config.bloomIntensity);

        // Bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fbos.dye.read.texture);

        // Render to canvas (null = default framebuffer)
        this.render(null, program);
    }

    /**
     * Add a splat (force + dye) at position
     */
    addSplat(x, y, dx, dy, color) {
        const gl = this.gl;

        // Normalize coordinates to [0, 1]
        const aspectRatio = this.canvas.width / this.canvas.height;
        const normX = x / this.canvas.width;
        const normY = 1.0 - (y / this.canvas.height); // Flip Y

        // Add velocity
        this.splatToFBO(
            this.fbos.velocity,
            normX,
            normY,
            dx * this.config.splatForce,
            -dy * this.config.splatForce,
            this.config.splatRadius / aspectRatio
        );

        // Add dye/color (clamped to prevent white flickering)
        if (color) {
            const clampedColor = [
                Math.min(0.5, Math.max(0, color[0])),
                Math.min(0.5, Math.max(0, color[1])),
                Math.min(0.5, Math.max(0, color[2]))
            ];
            this.splatToFBO(
                this.fbos.dye,
                normX,
                normY,
                clampedColor[0],
                clampedColor[1],
                this.config.splatRadius / aspectRatio,
                clampedColor[2]
            );
        }
    }

    /**
     * Splat a value into an FBO
     */
    splatToFBO(fbo, x, y, dx, dy, radius, dz = 0) {
        const gl = this.gl;

        // Create a simple splat by rendering an additive blend
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.write.fbo);
        gl.viewport(0, 0, fbo.write.width, fbo.write.height);

        // Read from current state
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fbo.read.texture);

        // Enable additive blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);

        // Use a simple program to add color (we'll create this on-demand)
        if (!this.splatProgram) {
            this.createSplatProgram();
        }

        const program = this.splatProgram;
        gl.useProgram(program.program);

        // Set uniforms
        gl.uniform2f(program.uniforms.u_point, x, y);
        gl.uniform3f(program.uniforms.u_color, dx, dy, dz);
        gl.uniform1f(program.uniforms.u_radius, radius);

        // Draw
        const posLoc = gl.getAttribLocation(program.program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        fbo.swap();
    }

    /**
     * Create splat shader program
     */
    createSplatProgram() {
        const vertShader = baseVertShader;
        const fragShader = `
            precision highp float;
            varying vec2 v_texCoord;
            uniform vec2 u_point;
            uniform vec3 u_color;
            uniform float u_radius;

            void main() {
                float dist = distance(v_texCoord, u_point);
                float splat = exp(-dist / u_radius);
                gl_FragColor = vec4(u_color * splat, 1.0);
            }
        `;

        this.splatProgram = this.createProgram(vertShader, fragShader);
    }

    /**
     * Clear an FBO to zero
     */
    clearFBO(fbo) {
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Resize simulation
     */
    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;

        // Recreate FBOs if needed
        // For simplicity, we'll keep simulation resolution fixed
        // and only update canvas size
    }

    /**
     * Clean up WebGL resources
     */
    cleanup() {
        if (!this.gl) return;

        const gl = this.gl;

        // Delete FBOs
        const deleteFBO = (fbo) => {
            if (fbo) {
                gl.deleteFramebuffer(fbo.fbo);
                gl.deleteTexture(fbo.texture);
            }
        };

        const deleteDoubleFBO = (doubleFBO) => {
            if (doubleFBO) {
                deleteFBO(doubleFBO.read);
                deleteFBO(doubleFBO.write);
            }
        };

        deleteDoubleFBO(this.fbos.velocity);
        deleteDoubleFBO(this.fbos.pressure);
        deleteDoubleFBO(this.fbos.dye);
        deleteFBO(this.fbos.divergence);

        // Delete programs
        Object.values(this.programs).forEach(program => {
            if (program && program.program) {
                gl.deleteProgram(program.program);
            }
        });

        // Delete buffers
        if (this.quadBuffer) {
            gl.deleteBuffer(this.quadBuffer);
        }

        this.isInitialized = false;
    }
}
