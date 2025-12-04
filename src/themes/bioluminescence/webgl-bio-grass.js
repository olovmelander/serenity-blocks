/**
 * WebGL Bio Grass - Instanced rendering for swaying bioluminescent grass
 */
export default class WebGLBioGrass {
    constructor(gl) {
        this.gl = gl;
        this.program = null;
        this.startTime = Date.now();
        this.bladeCount = 0;

        // Detect WebGL 2
        this.isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
    }

    init() {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

        // Extensions for WebGL 1
        if (!isWebGL2) {
            this.ext = gl.getExtension('ANGLE_instanced_arrays');
            if (!this.ext) {
                return false;
            }
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow

        // Vertex Shader
        const vsSource = isWebGL2 ? `#version 300 es
            in vec2 aPosition;
            in vec3 aInstanceOffset; // x, y, z
            in float aInstanceScale;
            in float aInstancePhase;
            in vec3 aInstanceColor;

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            out vec3 vColor;
            out float vHeight;
            out float vGlow;
            out float vPulse;
            out float vSegmentPhase;

            void main() {
                // Base position
                vec2 pos = aPosition * aInstanceScale;
                
                // Height factor (0 at bottom, 1 at top)
                float h = pos.y / 200.0; 
                
                // Worm-like Motion
                float t = uTime * 1.0 + aInstancePhase;
                
                // 1. Peristaltic movement (width expansion/contraction traveling up)
                float peristalsis = sin(t * 3.0 - h * 15.0);
                pos.x *= 1.0 + peristalsis * 0.4 * h; // More pronounced at top
                
                // 2. Sinuous body wave (Snake-like)
                float sway = sin(t + h * 5.0) * (10.0 + uWindStrength * 30.0) * h;
                float coil = cos(t * 0.5 + h * 8.0) * 5.0 * h;
                
                pos.x += sway + coil;
                
                // World position
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vHeight = h;
                vPulse = fract(uTime * 0.3 + aInstancePhase);
                vSegmentPhase = aInstancePhase; // Randomize segment alignment
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
            varying float vGlow;
            varying float vPulse;
            varying float vSegmentPhase;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                float h = pos.y / 200.0;
                float t = uTime * 1.0 + aInstancePhase;
                
                float peristalsis = sin(t * 3.0 - h * 15.0);
                pos.x *= 1.0 + peristalsis * 0.4 * h;
                
                float sway = sin(t + h * 5.0) * (10.0 + uWindStrength * 30.0) * h;
                float coil = cos(t * 0.5 + h * 8.0) * 5.0 * h;
                
                pos.x += sway + coil;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vHeight = h;
                vPulse = fract(uTime * 0.3 + aInstancePhase);
                vSegmentPhase = aInstancePhase;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec3 vColor;
            in float vHeight;
            in float vPulse;
            in float vSegmentPhase;
            out vec4 outColor;

            void main() {
                // Alien Worm Texture
                
                // Segmentation Pattern
                float segmentFreq = 30.0;
                float segments = sin(vHeight * segmentFreq + vSegmentPhase);
                float segmentLine = smoothstep(0.8, 0.95, segments); // Thin bright lines
                
                // Base Body Gradient
                vec3 bodyColor = vColor * (0.3 + vHeight * 0.5);
                
                // Internal Glow (Organs?)
                float internalPulse = sin(vHeight * 10.0 - uTime * 5.0);
                vec3 organGlow = vColor * smoothstep(0.0, 1.0, internalPulse) * 0.5;
                
                // Traveling Energy Pulse
                float pulsePos = vPulse;
                float pulseWidth = 0.2;
                float pulseGlow = smoothstep(pulseWidth, 0.0, abs(vHeight - pulsePos));
                
                vec3 finalColor = bodyColor;
                finalColor += organGlow;
                finalColor += vec3(1.0) * segmentLine * 0.3; // Highlight segments
                finalColor += vec3(0.8, 1.0, 1.0) * pulseGlow * 1.0; // Bright pulse
                
                // Tip Bioluminescence
                float tip = smoothstep(0.9, 1.0, vHeight);
                finalColor += vec3(1.0) * tip;

                // Alpha
                float alpha = 0.8;
                
                outColor = vec4(finalColor, alpha);
            }
        ` : `
            precision highp float;
            varying vec3 vColor;
            varying float vHeight;
            varying float vPulse;
            varying float vSegmentPhase;

            void main() {
                float segmentFreq = 30.0;
                float segments = sin(vHeight * segmentFreq + vSegmentPhase);
                float segmentLine = smoothstep(0.8, 0.95, segments);
                
                vec3 bodyColor = vColor * (0.3 + vHeight * 0.5);
                
                float internalPulse = sin(vHeight * 10.0 - uTime * 5.0);
                vec3 organGlow = vColor * smoothstep(0.0, 1.0, internalPulse) * 0.5;
                
                float pulsePos = vPulse;
                float pulseWidth = 0.2;
                float pulseGlow = smoothstep(pulseWidth, 0.0, abs(vHeight - pulsePos));
                
                vec3 finalColor = bodyColor;
                finalColor += organGlow;
                finalColor += vec3(1.0) * segmentLine * 0.3;
                finalColor += vec3(0.8, 1.0, 1.0) * pulseGlow * 1.0;
                
                float tip = smoothstep(0.9, 1.0, vHeight);
                finalColor += vec3(1.0) * tip;

                gl_FragColor = vec4(finalColor, 0.8);
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

        // Geometry (Worm Tendril)
        // Wider for worm look
        const bladeWidth = 16;
        const bladeHeight = 200;
        const vertices = new Float32Array([
            -bladeWidth / 2, 0.0,
            bladeWidth / 2, 0.0,
            0.0, bladeHeight
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
            offsets[i * 3 + 1] = Math.random() * 30; // Bottom 30px
            offsets[i * 3 + 2] = 0;

            // Scale
            scales[i] = 0.6 + Math.random() * 0.8; // Varying heights

            // Phase
            phases[i] = Math.random() * Math.PI * 2;

            // Color (Bioluminescent Organism Palette - Cyan/Blue/Green only)
            const variant = Math.random();
            if (variant < 0.6) {
                // Cyan/Electric Blue
                colors[i * 3] = 0.0;
                colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
                colors[i * 3 + 2] = 0.8 + Math.random() * 0.2;
            } else if (variant < 0.9) {
                // Deep Blue
                colors[i * 3] = 0.0;
                colors[i * 3 + 1] = 0.4 + Math.random() * 0.3;
                colors[i * 3 + 2] = 1.0;
            } else {
                // Alien Green
                colors[i * 3] = 0.2;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 0.4;
            }
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

    render(time, width, height, windStrength = 0.0) {
        if (!this.gl || !this.program || this.bladeCount === 0) return;
        const gl = this.gl;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, width, height);
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
            gl.drawArraysInstanced(gl.TRIANGLES, 0, 3, this.bladeCount);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 3, this.bladeCount);
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
