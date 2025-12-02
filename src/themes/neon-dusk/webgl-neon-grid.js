
/**
 * WebGL Neon Grid - Renders the synthwave grid in front of the mountains
 * for the Neon Dusk theme.
 */
export default class WebGLNeonGrid {
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow

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
            uniform vec3 uWaves[5]; // x: position, y: radius, z: intensity
            
            // Colors - Matching the photo
            const vec3 cGridPink = vec3(1.0, 0.0, 0.8);      // Hot Pink
            const vec3 cGridPurple = vec3(0.8, 0.0, 1.0);    // Violet
            const vec3 cFog = vec3(0.4, 0.0, 0.6);           // Purple haze
            
            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                
                // --- GRID (FLOOR) ---
                float gridHorizon = 0.25; // Lower horizon to keep grid on the ground
                
                if (uv.y < gridHorizon) {
                     float z = 0.5 / (gridHorizon - uv.y);

                     // Movement
                     float speed = 1.5;
                     vec2 gp = vec2(uv.x * z * 1.5, z + uTime * speed);

                     // Pulsing effect
                     float pulse = 0.9 + 0.1 * sin(uTime * 2.0);

                     // Grid lines
                     float gw = 0.08 * z; 
                     float g = max(
                        smoothstep(1.0-gw, 1.0, fract(gp.x)),
                        smoothstep(1.0-gw, 1.0, fract(gp.y))
                     );

                     // Glow
                     float gwGlow = 0.25 * z;
                     float gGlow = max(
                        smoothstep(1.0-gwGlow, 1.0, fract(gp.x)),
                        smoothstep(1.0-gwGlow, 1.0, fract(gp.y))
                     );

                     // Fog/Fade - Grid lines fade out
                     float gFog = 1.0 - smoothstep(0.0, 30.0, z);

                     // Color gradient
                     float colorMix = smoothstep(0.0, 15.0, z);
                     vec3 gridColor = mix(cGridPink, cGridPurple, colorMix);

                     // Combine Grid
                     vec3 finalColor = gridColor * (g * 3.0 + gGlow * 1.5) * gFog * pulse;

                     // Scanline
                     float scanline = sin(gp.y * 15.0 - uTime * 3.0) * 0.1 + 0.9;
                     finalColor *= scanline;

                     // Waves
                     float waveEffect = 0.0;
                     for (int i = 0; i < 5; i++) {
                         if (uWaves[i].z > 0.01) {
                             float waveX = uWaves[i].x;
                             float waveRadius = uWaves[i].y;
                             float waveIntensity = uWaves[i].z;

                             float distX = abs(gp.x - waveX * 2.0);
                             float waveDist = abs(z - waveRadius * 25.0);

                             float ripple = sin(waveDist * 1.5 - uTime * 5.0) * 0.5 + 0.5;
                             float waveMask = exp(-waveDist * 0.08) * waveIntensity;

                             waveEffect += ripple * waveMask;
                         }
                     }

                     finalColor += cGridPink * waveEffect * 4.0;

                     // Horizon Fog - Add a glowy haze near the horizon
                     float horizonDist = gridHorizon - uv.y;
                     float fogFactor = exp(-horizonDist * 12.0); // Spread further (was 20.0)
                     finalColor += cFog * fogFactor * 1.5; // More intense (was 0.8)

                     // Output
                     // Increase alpha with fog so it's visible
                     float alpha = max(finalColor.r * 0.5, fogFactor * 0.9);
                     gl_FragColor = vec4(finalColor, alpha);
                } else {
                    gl_FragColor = vec4(0.0);
                }
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

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(this.positionAttribute);
        gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(this.timeUniform, currentTime);
        gl.uniform2f(this.resolutionUniform, this.canvas.width, this.canvas.height);

        const waveData = new Float32Array(15);
        for (let i = 0; i < Math.min(waves.length, 5); i++) {
            waveData[i * 3] = waves[i].x;
            waveData[i * 3 + 1] = waves[i].radius;
            waveData[i * 3 + 2] = waves[i].intensity;
        }
        gl.uniform3fv(this.wavesUniform, waveData);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
