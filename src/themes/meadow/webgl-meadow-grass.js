
/**
 * WebGL Meadow Grass - Instanced rendering for swaying grass blades
 */
export default class WebGLMeadowGrass {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
        this.bladeCount = 0;
    }

    init() {
        // Try WebGL 2 first
        let gl = this.canvas.getContext('webgl2', { alpha: true });
        let isWebGL2 = !!gl;

        if (!gl) {
            gl = this.canvas.getContext('webgl', { alpha: true });
        }

        if (!gl) return false;
        this.gl = gl;
        this.isWebGL2 = isWebGL2;

        // Extensions for WebGL 1
        if (!isWebGL2) {
            this.ext = gl.getExtension('ANGLE_instanced_arrays');
            if (!this.ext) {
                console.warn('WebGL Meadow Grass: Instancing not supported');
                return false;
            }
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Vertex Shader
        const vsSource = isWebGL2 ? `#version 300 es
            in vec2 aPosition;
            in vec3 aInstanceOffset; // x, y, z (z unused)
            in float aInstanceScale;
            in float aInstancePhase;
            in vec3 aInstanceColor;

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            out vec3 vColor;
            out float vHeight;
            out float vLighting;

            void main() {
                // Base position
                vec2 pos = aPosition * aInstanceScale;
                
                // Wind animation - More complex and natural
                float wind = 0.0;
                float bend = 0.0;
                
                if (aPosition.y > 0.0) {
                    // Multi-layered wind noise approximation
                    float t = uTime * 0.8 + aInstancePhase + aInstanceOffset.x * 0.002;
                    float t2 = uTime * 1.5 + aInstancePhase * 2.0 + aInstanceOffset.x * 0.01;
                    
                    // Main sway
                    float sway = sin(t) * (0.1 + uWindStrength * 2.0);
                    // Turbulence
                    float turbulence = sin(t2) * (0.05 + uWindStrength);
                    
                    wind = (sway + turbulence) * pow(aPosition.y / 60.0, 2.0) * 20.0;
                    
                    // Vertical compression when bending (fake 3D length preservation)
                    bend = abs(wind) * 0.2;
                }
                
                pos.x += wind;
                pos.y -= bend;
                
                // World position
                vec2 worldPos = pos + aInstanceOffset.xy;
                
                // Convert to clip space (-1 to 1)
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vHeight = aPosition.y / 60.0; // Normalize height for gradient
                
                // Simple fake lighting based on wind direction
                vLighting = 1.0 + wind * 0.02; 
            }
        ` : `
            attribute vec2 aPosition;
            attribute vec3 aInstanceOffset;
            attribute float aInstanceScale;
            attribute float aInstancePhase;
            attribute vec3 aInstanceColor;

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            varying vec3 vColor;
            varying float vHeight;
            varying float vLighting;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                float wind = 0.0;
                float bend = 0.0;
                
                if (aPosition.y > 0.0) {
                    float t = uTime * 0.8 + aInstancePhase + aInstanceOffset.x * 0.002;
                    float t2 = uTime * 1.5 + aInstancePhase * 2.0 + aInstanceOffset.x * 0.01;
                    
                    float sway = sin(t) * (0.1 + uWindStrength * 2.0);
                    float turbulence = sin(t2) * (0.05 + uWindStrength);
                    
                    wind = (sway + turbulence) * pow(aPosition.y / 60.0, 2.0) * 20.0;
                    bend = abs(wind) * 0.2;
                }
                
                pos.x += wind;
                pos.y -= bend;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vHeight = aPosition.y / 60.0;
                vLighting = 1.0 + wind * 0.02;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec3 vColor;
            in float vHeight;
            in float vLighting;
            out vec4 outColor;

            void main() {
                // Gradient on blade: Darker at bottom, lighter at top
                // Add a bit of yellow/brown to the tip for realism
                vec3 bottomColor = vColor * 0.4; // Darker base (ambient occlusion)
                vec3 midColor = vColor * 1.1;
                vec3 topColor = vColor * 1.3 + vec3(0.1, 0.1, 0.0); // Sun-kissed tip
                
                vec3 col = mix(bottomColor, midColor, vHeight * 1.5);
                if (vHeight > 0.66) {
                    col = mix(midColor, topColor, (vHeight - 0.66) * 3.0);
                }
                
                // Apply lighting
                col *= vLighting;
                
                outColor = vec4(col, 1.0);
            }
        ` : `
            precision highp float;
            varying vec3 vColor;
            varying float vHeight;
            varying float vLighting;

            void main() {
                vec3 bottomColor = vColor * 0.4;
                vec3 midColor = vColor * 1.1;
                vec3 topColor = vColor * 1.3 + vec3(0.1, 0.1, 0.0);
                
                vec3 col = mix(bottomColor, midColor, vHeight * 1.5);
                if (vHeight > 0.66) {
                    col = mix(midColor, topColor, (vHeight - 0.66) * 3.0);
                }
                
                col *= vLighting;
                
                gl_FragColor = vec4(col, 1.0);
            }
        `;

        const program = this.createProgram(gl, vsSource, fsSource);
        if (!program) return false;
        this.program = program;

        // Attributes
        this.attribs = {
            position: gl.getAttribLocation(program, 'aPosition'),
            offset: gl.getAttribLocation(program, 'aInstanceOffset'),
            scale: gl.getAttribLocation(program, 'aInstanceScale'),
            phase: gl.getAttribLocation(program, 'aInstancePhase'),
            color: gl.getAttribLocation(program, 'aInstanceColor'),
        };

        // Uniforms
        this.uniforms = {
            time: gl.getUniformLocation(program, 'uTime'),
            resolution: gl.getUniformLocation(program, 'uResolution'),
            windStrength: gl.getUniformLocation(program, 'uWindStrength'),
        };

        // Geometry (Curved blade using 5 vertices for smoother bend)
        // 0: Bottom Left
        // 1: Bottom Right
        // 2: Mid Left
        // 3: Mid Right
        // 4: Top Center
        const w = 7.0; // Slightly wider base
        const h = 60.0;

        // Triangle Strip
        const vertices = new Float32Array([
            -w / 2, 0.0,      // 0
            w / 2, 0.0,       // 1
            -w / 3, h * 0.5,    // 2
            w / 3, h * 0.5,     // 3
            0.0, h          // 4
        ]);

        this.buffers = {};
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return null;

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    generateGrass(count, width, height) {
        const gl = this.gl;
        this.bladeCount = count;

        const offsets = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            // Position
            offsets[i * 3] = Math.random() * width;
            // Start slightly below screen (-50) up to 25% height
            offsets[i * 3 + 1] = -50 + Math.random() * (height * 0.25 + 50);
            offsets[i * 3 + 2] = 0; // z unused

            // Scale
            scales[i] = 0.7 + Math.random() * 0.8;

            // Phase
            phases[i] = Math.random() * Math.PI * 2;

            // Color (Natural Green variations)
            // Base green: rgb(50, 160, 50) -> 0.2, 0.6, 0.2
            const r = 0.15 + Math.random() * 0.1;
            const g = 0.5 + Math.random() * 0.2;
            const b = 0.1 + Math.random() * 0.15;
            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        // Create Instance Buffers
        this.buffers.offset = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.offset);
        gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);

        this.buffers.scale = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.bufferData(gl.ARRAY_BUFFER, scales, gl.STATIC_DRAW);

        this.buffers.phase = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.bufferData(gl.ARRAY_BUFFER, phases, gl.STATIC_DRAW);

        this.buffers.color = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, windStrength = 0.0) {
        if (!this.gl || !this.program || this.bladeCount === 0) return;
        const gl = this.gl;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.windStrength, windStrength);

        // Bind Geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        // Bind Instances
        // Offset
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.offset);
        gl.enableVertexAttribArray(this.attribs.offset);
        gl.vertexAttribPointer(this.attribs.offset, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.offset, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.offset, 1);

        // Scale
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.enableVertexAttribArray(this.attribs.scale);
        gl.vertexAttribPointer(this.attribs.scale, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.scale, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 1);

        // Phase
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.enableVertexAttribArray(this.attribs.phase);
        gl.vertexAttribPointer(this.attribs.phase, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.phase, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 1);

        // Color
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.color, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.color, 1);

        // Draw
        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 5, this.bladeCount);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 5, this.bladeCount);
        }

        // Reset divisors
        if (this.isWebGL2) {
            gl.vertexAttribDivisor(this.attribs.offset, 0);
            gl.vertexAttribDivisor(this.attribs.scale, 0);
            gl.vertexAttribDivisor(this.attribs.phase, 0);
            gl.vertexAttribDivisor(this.attribs.color, 0);
        } else {
            this.ext.vertexAttribDivisorANGLE(this.attribs.offset, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.color, 0);
        }
    }
}
