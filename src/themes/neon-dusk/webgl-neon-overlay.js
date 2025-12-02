
/**
 * WebGL Neon Overlay - Renders a VHS/CRT style overlay
 * for the Neon Dusk theme.
 */
export default class WebGLNeonOverlay {
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

            uniform float uTime;
            uniform vec2 uResolution;
            
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                
                // 1. Scanlines (Darken every other line)
                // Use a high frequency sine wave
                float scanlineCount = uResolution.y * 0.5; // Every 2 pixels
                float scanline = sin(uv.y * scanlineCount * 3.14159 * 2.0);
                
                // 2. Slow moving VHS tracking lines (Horizontal bands)
                float tracking = sin(uv.y * 5.0 + uTime * 0.5);
                
                // 3. Noise/Grain
                float noise = random(uv + uTime * 10.0);
                
                // Combine effects into an alpha value (how much to darken/tint)
                float alpha = 0.0;
                
                // Scanlines: Darken more (0.0 to 0.3)
                if (scanline > 0.5) {
                    alpha += 0.3;
                }
                
                // Tracking: Darkening bands
                alpha += (tracking + 1.0) * 0.05;
                
                // Noise: Grain
                alpha += noise * 0.12;
                
                // Vignette: Darken edges
                float vig = length(uv - 0.5);
                alpha += smoothstep(0.4, 0.8, vig) * 0.5;
                
                // Output black with calculated alpha
                // This darkens the underlying layers
                gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
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

    render(time) {
        if (!this.gl || !this.program) return;
        const gl = this.gl;
        const currentTime = time || (Date.now() - this.startTime) * 0.001;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(this.positionAttribute);
        gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(this.timeUniform, currentTime);
        gl.uniform2f(this.resolutionUniform, this.canvas.width, this.canvas.height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
