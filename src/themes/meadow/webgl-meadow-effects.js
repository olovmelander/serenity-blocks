
/**
 * WebGL Meadow Effects - Particle system for pollen, seeds, and combo effects
 */
export default class WebGLMeadowEffects {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
        this.particles = [];
        this.MAX_PARTICLES = 1000;
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
            if (!this.ext) return false;
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glowy particles

        // Vertex Shader
        const vsSource = isWebGL2 ? `#version 300 es
            in vec2 aPosition;
            in vec3 aInstancePosition; // x, y, z
            in float aInstanceSize;
            in vec4 aInstanceColor; // r, g, b, a

            uniform float uTime;
            uniform vec2 uResolution;

            out vec4 vColor;
            out vec2 vUv;

            void main() {
                vec2 pos = aPosition * aInstanceSize;
                vec2 worldPos = pos + aInstancePosition.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.5 + 0.5;
            }
        ` : `
            attribute vec2 aPosition;
            attribute vec3 aInstancePosition;
            attribute float aInstanceSize;
            attribute vec4 aInstanceColor;

            uniform float uTime;
            uniform vec2 uResolution;

            varying vec4 vColor;
            varying vec2 vUv;

            void main() {
                vec2 pos = aPosition * aInstanceSize;
                vec2 worldPos = pos + aInstancePosition.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.5 + 0.5;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec4 vColor;
            in vec2 vUv;
            out vec4 outColor;

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                // Soft particle
                float alpha = smoothstep(1.0, 0.0, dist);
                alpha = pow(alpha, 2.0); // Sharper falloff
                
                outColor = vColor * alpha;
            }
        ` : `
            precision highp float;
            varying vec4 vColor;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                float alpha = smoothstep(1.0, 0.0, dist);
                alpha = pow(alpha, 2.0);
                
                gl_FragColor = vColor * alpha;
            }
        `;

        const program = this.createProgram(gl, vsSource, fsSource);
        if (!program) return false;
        this.program = program;

        // Attributes
        this.attribs = {
            position: gl.getAttribLocation(program, 'aPosition'),
            instancePosition: gl.getAttribLocation(program, 'aInstancePosition'),
            size: gl.getAttribLocation(program, 'aInstanceSize'),
            color: gl.getAttribLocation(program, 'aInstanceColor'),
        };

        // Uniforms
        this.uniforms = {
            time: gl.getUniformLocation(program, 'uTime'),
            resolution: gl.getUniformLocation(program, 'uResolution'),
        };

        // Geometry (Quad)
        const vertices = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1
        ]);

        this.buffers = {};
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        // Dynamic buffers
        this.buffers.instancePosition = gl.createBuffer();
        this.buffers.size = gl.createBuffer();
        this.buffers.color = gl.createBuffer();

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

    createPollen(count, width, height) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.2, // Very slow drift
                vy: (Math.random() - 0.5) * 0.2,
                size: 1 + Math.random() * 2, // Tiny
                color: [1.0, 1.0, 0.9, 0.4], // Very transparent
                life: 100.0,
                type: 'pollen'
            });
        }
    }

    createBurst(x, y, count, color) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1 + Math.random() * 3; // Slower burst
            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 3 + Math.random() * 4,
                color: color || [1.0, 1.0, 1.0, 1.0],
                life: 1.0 + Math.random() * 0.5,
                decay: 0.015, // Slower fade
                type: 'burst'
            });
        }
    }

    update(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;

            if (p.type === 'pollen') {
                // Wrap around
                if (p.x < 0) p.x = this.canvas.width;
                if (p.x > this.canvas.width) p.x = 0;
                if (p.y < 0) p.y = this.canvas.height;
                if (p.y > this.canvas.height) p.y = 0;

                // Subtle Jitter
                p.vx += (Math.random() - 0.5) * 0.005;
                p.vy += (Math.random() - 0.5) * 0.005;
                // Dampen
                p.vx *= 0.995;
                p.vy *= 0.995;
            } else {
                // Burst particles die
                p.life -= p.decay;
                p.color[3] = p.life; // Fade alpha
                if (p.life <= 0) {
                    this.particles.splice(i, 1);
                }
            }
        }
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, dt) {
        if (!this.gl || !this.program) return;

        this.update(dt);

        const gl = this.gl;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);

        const count = this.particles.length;
        if (count === 0) return;

        // Update Buffers
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const colors = new Float32Array(count * 4);

        for (let i = 0; i < count; i++) {
            const p = this.particles[i];
            positions[i * 3] = p.x;
            positions[i * 3 + 1] = p.y;
            positions[i * 3 + 2] = 0;

            sizes[i] = p.size;

            colors[i * 4] = p.color[0];
            colors[i * 4 + 1] = p.color[1];
            colors[i * 4 + 2] = p.color[2];
            colors[i * 4 + 3] = p.color[3];
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instancePosition);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

        // Bind Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        // Instanced Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instancePosition);
        gl.enableVertexAttribArray(this.attribs.instancePosition);
        gl.vertexAttribPointer(this.attribs.instancePosition, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.instancePosition, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.instancePosition, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.enableVertexAttribArray(this.attribs.size);
        gl.vertexAttribPointer(this.attribs.size, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.size, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.size, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.color, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.color, 1);

        // Draw
        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
        }

        // Reset divisors
        if (this.isWebGL2) {
            gl.vertexAttribDivisor(this.attribs.instancePosition, 0);
            gl.vertexAttribDivisor(this.attribs.size, 0);
            gl.vertexAttribDivisor(this.attribs.color, 0);
        } else {
            this.ext.vertexAttribDivisorANGLE(this.attribs.instancePosition, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.size, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.color, 0);
        }
    }
}
