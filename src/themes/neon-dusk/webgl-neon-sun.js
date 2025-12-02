
export default class WebGLNeonSun {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.attributes = {};
        this.uniforms = {};
        this.buffers = {};
    }

    init() {
        const gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: true
        }) || this.canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: true
        });

        if (!gl) return false;
        this.gl = gl;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        if (!this.initSunShaders()) return false;

        this.initBuffers();

        return true;
    }

    initSunShaders() {
        const gl = this.gl;

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
            
            uniform vec2 uResolution;
            uniform vec2 uPosition;
            uniform float uRadius;
            uniform vec3 uColorTop;
            uniform vec3 uColorBottom;
            uniform float uTime;
            
            void main() {
                vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                vec2 center = uPosition;
                
                float dist = length(uv - center);
                
                // Sun Body Mask
                float sunMask = smoothstep(uRadius + 0.01, uRadius - 0.01, dist);

                // Multi-layer Outer Glow for more vibrant effect
                float glowDist = max(0.0, dist - uRadius);
                float glow1 = exp(-glowDist * 6.0) * 1.2;   // Intense inner glow
                float glow2 = exp(-glowDist * 3.0) * 0.6;   // Medium outer glow
                float glow3 = exp(-glowDist * 1.5) * 0.3;   // Soft far glow
                float glow = glow1 + glow2 + glow3;
                
                // Combine Alpha
                float alpha = sunMask + glow;
                
                
                if (alpha < 0.01) discard;
                
                // Gradient with enhanced contrast
                float t = (uv.y - center.y + uRadius) / (2.0 * uRadius);
                t = clamp(t, 0.0, 1.0);
                t = pow(t, 0.9); // Slightly non-linear for more vibrant gradient
                vec3 bodyColor = mix(uColorBottom, uColorTop, t);

                // Boost saturation
                bodyColor *= 1.15;
                
                // Glow Color - More vibrant with pulsing
                vec3 glowColor = mix(uColorBottom, uColorTop, 0.5);
                float pulse = 0.9 + 0.1 * sin(uTime * 1.5); // Subtle pulsing
                glowColor *= 1.3 * pulse; // Brighter, pulsing glow

                // Composite with enhanced brightness
                vec3 finalColor = mix(glowColor * glow, bodyColor, sunMask);

                gl_FragColor = vec4(finalColor, alpha);
            }
        `;

        this.program = this.createProgram(gl, vsSource, fsSource);
        if (!this.program) return false;

        this.attributes = {
            position: gl.getAttribLocation(this.program, 'aPosition'),
        };

        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'uResolution'),
            position: gl.getUniformLocation(this.program, 'uPosition'),
            radius: gl.getUniformLocation(this.program, 'uRadius'),
            colorTop: gl.getUniformLocation(this.program, 'uColorTop'),
            colorBottom: gl.getUniformLocation(this.program, 'uColorBottom'),
            time: gl.getUniformLocation(this.program, 'uTime'),
        };

        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error('VS Error:', gl.getShaderInfoLog(vs));
            return null;
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error('FS Error:', gl.getShaderInfoLog(fs));
            return null;
        }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Link Error:', gl.getProgramInfoLog(prog));
            return null;
        }
        return prog;
    }

    initBuffers() {
        const gl = this.gl;
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, params) {
        const gl = this.gl;
        if (!gl || !this.program) return;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);

        const x = params.x !== undefined ? params.x : 0.0;
        const y = params.y !== undefined ? params.y : 0.0;
        gl.uniform2f(this.uniforms.position, x, y);

        gl.uniform1f(this.uniforms.radius, params.radius || 0.25);

        const cTop = params.colorTop || [0.0, 1.0, 1.0];
        const cBot = params.colorBottom || [1.0, 0.0, 1.0];

        gl.uniform3f(this.uniforms.colorTop, cTop[0], cTop[1], cTop[2]);
        gl.uniform3f(this.uniforms.colorBottom, cBot[0], cBot[1], cBot[2]);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
