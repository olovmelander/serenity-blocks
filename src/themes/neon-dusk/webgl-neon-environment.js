
/**
 * WebGL Neon Environment - Renders the complete background scene (Sky, Sun, Mountains, Grid)
 * for the Neon Dusk theme in a single efficient pass.
 */
export default class WebGLNeonEnvironment {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
    }

    init() {
        const gl = this.canvas.getContext('webgl2', { alpha: false }) ||
            this.canvas.getContext('webgl', { alpha: false });

        if (!gl) return false;
        this.gl = gl;

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

            uniform float uTime;
            uniform vec2 uResolution;
            
            // Colors - Enhanced for better depth and vibrancy (Photo Match)
            const vec3 cSkyTop = vec3(0.1, 0.0, 0.3);        // Deep Purple/Blue
            const vec3 cSkyBot = vec3(0.8, 0.0, 0.5);        // Vibrant Magenta/Pink
            
            // Pseudo-random
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }
            
            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                
                vec3 color = vec3(0.0);
                
                // --- SKY ---
                float skyGradient = smoothstep(0.0, 1.0, uv.y);
                color = mix(cSkyBot, cSkyTop, skyGradient);
                
                // Stars - More visible with color variation
                float star = step(0.997, hash(uv * 1.5));
                float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + uv.x * 50.0);
                float starHue = hash(uv * 2.0);
                vec3 starColor = mix(vec3(1.0), vec3(0.5, 0.8, 1.0), starHue * 0.3); // Slight blue tint
                color += star * twinkle * starColor * 1.2;

                // Minimal Vignette - Only at extreme edges
                float vig = 1.0 - length(uv - 0.5) * 0.15; // Very minimal effect
                vig = pow(vig, 0.98); // Almost no falloff
                color *= vig;

                gl_FragColor = vec4(color, 1.0);
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
        this.wavesUniform = gl.getUniformLocation(program, 'uWaves');

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

    render(time, waves = []) {
        if (!this.gl || !this.program) return;
        const gl = this.gl;
        const currentTime = time || (Date.now() - this.startTime) * 0.001;

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(this.positionAttribute);
        gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(this.timeUniform, currentTime);
        gl.uniform2f(this.resolutionUniform, this.canvas.width, this.canvas.height);

        // Pass wave data to shader
        const waveData = new Float32Array(15); // 5 waves * 3 floats (x, radius, intensity)
        for (let i = 0; i < Math.min(waves.length, 5); i++) {
            waveData[i * 3] = waves[i].x;
            waveData[i * 3 + 1] = waves[i].radius;
            waveData[i * 3 + 2] = waves[i].intensity;
        }
        gl.uniform3fv(this.wavesUniform, waveData);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
