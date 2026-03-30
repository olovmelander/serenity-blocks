/**
 * WebGL Meadow Environment - Renders the sky, sun, and clouds
 */
export default class WebGLMeadowEnvironment {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
    }

    init() {
        const gl = this.canvas.getContext('webgl2', { alpha: false })
            || this.canvas.getContext('webgl', { alpha: false });

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
            
            // Meadow Sky Colors - Softer, more pastel
            const vec3 cSkyTop = vec3(0.2, 0.6, 0.9);     // Deep Blue
            const vec3 cSkyBot = vec3(1.0, 0.9, 0.7);     // Golden Haze
            const vec3 cSunColor = vec3(1.0, 0.6, 0.1);   // Deep Golden Orange Sun
            
            // Noise function for clouds
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
                           mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
            }

            float fbm(vec2 p) {
                float v = 0.0;
                v += 0.5 * noise(p); p *= 2.0;
                v += 0.25 * noise(p); p *= 2.0;
                v += 0.125 * noise(p); p *= 2.0;
                return v;
            }
            
            void main() {
                vec2 uv = gl_FragCoord.xy / uResolution.xy;
                
                // Sky Gradient
                vec3 color = mix(cSkyBot, cSkyTop, smoothstep(0.0, 1.0, uv.y));
                
                // Sun - Softer, more atmospheric
                vec2 sunPos = vec2(0.85, 0.85);
                float aspectRatio = uResolution.x / uResolution.y;
                vec2 sunUV = uv;
                sunUV.x *= aspectRatio;
                vec2 sunPosCorrected = sunPos;
                sunPosCorrected.x *= aspectRatio;
                
                float sunDist = length(sunUV - sunPosCorrected);
                
                // Sun Core (Soft circle)
                float sunCore = smoothstep(0.12, 0.06, sunDist);
                
                // Sun Glow (Wide atmospheric glow)
                float sunGlow = exp(-sunDist * 2.5) * 0.8;
                
                // Sun Rays (Subtle)
                float angle = atan(uv.y - sunPos.y, uv.x - sunPos.x);
                float rays = sin(angle * 12.0 + uTime * 0.05) * 0.05 + 0.95; // Very subtle rays
                sunGlow *= rays;
                
                // Mix sun color: mostly golden, very little white even in center
                vec3 sunFinalColor = mix(cSunColor, vec3(1.0, 0.9, 0.6), sunCore * 0.3);
                
                color += sunFinalColor * (sunCore * 0.6 + sunGlow);
                
                // Clouds - Fluffy and slow
                float cloudTime = uTime * 0.02; // Very slow
                vec2 cloudUV = uv * vec2(1.5, 1.0) + vec2(cloudTime, 0.0);
                float cloudNoise = fbm(cloudUV * 2.5);
                
                // Cloud shape
                float cloudDensity = smoothstep(0.45, 0.75, cloudNoise);
                // Soft edges and fade at bottom
                cloudDensity *= smoothstep(0.0, 0.2, uv.y - 0.3); 
                
                vec3 cloudColor = vec3(1.0, 1.0, 0.98);
                // Add shading to clouds
                float shadow = fbm(cloudUV * 2.5 + vec2(0.03, -0.03));
                cloudColor = mix(cloudColor, vec3(0.9, 0.9, 0.95), shadow);
                
                color = mix(color, cloudColor, cloudDensity * 0.7);
                
                // Vignette - Very subtle
                float vig = 1.0 - length(uv - 0.5) * 0.2;
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
        const { gl } = this;

        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

        gl.enableVertexAttribArray(this.positionAttribute);
        gl.vertexAttribPointer(this.positionAttribute, 2, gl.FLOAT, false, 0, 0);

        gl.uniform1f(this.timeUniform, time);
        gl.uniform2f(this.resolutionUniform, this.canvas.width, this.canvas.height);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
