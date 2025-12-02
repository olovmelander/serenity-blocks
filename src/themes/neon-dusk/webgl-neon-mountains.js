/**
 * WebGL Neon Mountains - Renders mountain silhouettes in front of the sun
 * for the Neon Dusk theme as a separate foreground layer.
 */
export default class WebGLNeonMountains {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
    }

    init() {
        const gl = this.canvas.getContext('webgl2', { alpha: true }) ||
            this.canvas.getContext('webgl', { alpha: true });

        if (!gl) return false;
        this.gl = gl;

        // Enable blending for transparency
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Full screen quad
        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fsSource = `
            precision highp float;
            varying vec2 vUv;

            uniform float uGlowIntensity; // Added for combo glow
            uniform float uTime;          // Restored missing uniform
            uniform vec2 uResolution;

            // Colors - Two mountain layers with enhanced visibility
            const vec3 cMountainBack = vec3(0.05, 0.0, 0.1);   // Very dark purple/black
            const vec3 cMountainFront = vec3(0.02, 0.0, 0.05); // Almost black
            const vec3 cSkyBot = vec3(0.8, 0.0, 0.5);          // Match new sky bot
            const vec3 cNeonPink = vec3(1.0, 0.0, 0.8);        // Hot Pink Rim

            // Pseudo-random
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }

            // Mountain Generation
            float mountain(vec2 uv, float scale, float speed, float offset, float height) {
                float x = uv.x * scale + uTime * speed + offset;
                float n = noise(vec2(x, 0.0));
                // Add some detail - High Definition
                n += 0.5 * noise(vec2(x * 2.0, 10.0));
                n += 0.25 * noise(vec2(x * 4.0, 20.0));
                n += 0.125 * noise(vec2(x * 8.0, 30.0)); // Fine detail
                n += 0.06 * noise(vec2(x * 16.0, 40.0)); // Micro detail
                return n * height;
            }

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                vec2 p = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;

                // Boost glow based on combo intensity
                float glowBoost = 1.0 + uGlowIntensity * 2.0;
                float widthBoost = 1.0 + uGlowIntensity * 0.5;

                vec4 color = vec4(0.0, 0.0, 0.0, 0.0); // Start transparent

                // --- MOUNTAINS (2 Layers) ---
                float horizon = 0.45; // Raised horizon for higher mountains

                // Back Layer - More visible with reduced atmospheric fade
                float m1 = mountain(uv, 4.0, 0.015, 0.0, 0.18);
                float h1 = horizon + m1;
                vec3 colM1 = mix(cMountainBack, cSkyBot, 0.1); // Very subtle fade
                // Add stronger rim light from sun (magenta/purple) with combo glow boost
                float rim1 = smoothstep(0.008 * widthBoost, 0.0, abs((uv.y - h1))) * 0.7 * glowBoost; // Brighter rim
                colM1 += vec3(0.8, 0.0, 1.0) * rim1; // Purple rim
                float mask1 = step(uv.y, h1);
                color = mix(color, vec4(colM1, 1.0), mask1);

                // Front Layer - Highly visible silhouette with bright pink rim glow
                float m2 = mountain(uv, 7.0, 0.04, 150.0, 0.14);
                float h2 = horizon - 0.08 + m2;
                vec3 colM2 = cMountainFront;

                // Multi-layer rim light for highly visible outline
                float edgeDist = abs(uv.y - h2);

                // Bright core rim (thin, intense, anti-aliased)
                float rimCore = smoothstep(0.0025 * widthBoost, 0.0005 * widthBoost, edgeDist) * 2.0 * glowBoost;

                // Medium glow layer - smoother
                float rimGlow1 = smoothstep(0.006 * widthBoost, 0.002 * widthBoost, edgeDist) * 1.5 * glowBoost;

                // Wide outer glow - smoother
                float rimGlow2 = smoothstep(0.018 * widthBoost, 0.005 * widthBoost, edgeDist) * 0.8 * glowBoost;

                // Combine all rim layers for maximum visibility
                vec3 rimLight = cNeonPink * (rimCore + rimGlow1 + rimGlow2);
                colM2 += rimLight;

                float mask2 = step(uv.y, h2);
                color = mix(color, vec4(colM2, 1.0), mask2);

                gl_FragColor = color;
            }
        `;

        const program = this.createProgram(gl, vsSource, fsSource);
        if (!program) return false;
        this.program = program;

        // Buffers
        const positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);

        this.positionAttribute = gl.getAttribLocation(program, 'aPosition');
        this.timeUniform = gl.getUniformLocation(program, 'uTime');
        this.resolutionUniform = gl.getUniformLocation(program, 'uResolution');
        this.glowIntensityUniform = gl.getUniformLocation(program, 'uGlowIntensity');

        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(vs));
            return null;
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(fs));
            return null;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(glowIntensity = 0.0) {
        if (!this.gl || !this.program) return;
        const gl = this.gl;
        const time = (Date.now() - this.startTime) * 0.001;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(this.positionAttribute);
        gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(this.timeUniform, time);
        gl.uniform2f(this.resolutionUniform, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.glowIntensityUniform, glowIntensity);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
