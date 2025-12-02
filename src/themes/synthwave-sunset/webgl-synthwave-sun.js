
export default class WebGLSynthwaveSun {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.attributes = {};
        this.uniforms = {};
        this.buffers = {};

        // Star data
        this.starProgram = null;
        this.starAttributes = {};
        this.starUniforms = {};
        this.starBuffers = {};
        this.starCount = 0;
        this.maxStars = 2000;
        this.starData = null;
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
        if (!this.initStarShaders()) return false;

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
            uniform float uStripeCount;
            uniform float uTime;
            
            void main() {
                vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                vec2 center = uPosition;
                
                float dist = length(uv - center);
                
                // Sun Body Mask (1.0 inside, 0.0 outside)
                float sunMask = smoothstep(uRadius + 0.005, uRadius - 0.005, dist);
                
                // Outer Glow
                // Calculate distance from edge of sun
                float glowDist = max(0.0, dist - uRadius);
                // Exponential falloff for glow
                float glow = exp(-glowDist * 6.0) * 1.0;
                
                // Combine Alpha
                float alpha = sunMask + glow;
                
                if (alpha < 0.01) discard;
                
                // Sun Gradient
                float t = (uv.y - center.y + uRadius) / (2.0 * uRadius);
                t = clamp(t, 0.0, 1.0);
                t = pow(t, 0.8);
                vec3 bodyColor = mix(uColorBottom, uColorTop, t);
                
                // Glow Color (Warm Gold/Orange)
                vec3 glowColor = mix(uColorBottom, uColorTop, 0.8);
                
                // Composite
                // Inside sun: bodyColor
                // Outside sun: glowColor * glow intensity
                vec3 finalColor = mix(glowColor * glow, bodyColor, sunMask);
                
                // Ensure alpha is applied to output for blending
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
            stripeCount: gl.getUniformLocation(this.program, 'uStripeCount'),
            time: gl.getUniformLocation(this.program, 'uTime'),
        };

        return true;
    }

    initStarShaders() {
        const gl = this.gl;

        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            attribute float aSize;
            attribute float aBrightness;
            
            uniform vec2 uResolution;
            uniform float uTime;
            
            varying float vBrightness;
            
            void main() {
                // Map 0->width to -1->1
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                float twinkle = 0.8 + 0.2 * sin(uTime * 3.0 + aPosition.x * 0.1);
                vBrightness = aBrightness * twinkle;
                
                gl_PointSize = aSize;
            }
        `;

        const fsSource = `
            precision highp float;
            varying float vBrightness;
            
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord) * 2.0;
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                if (alpha < 0.01) discard;
                
                vec3 color = vec3(0.9, 0.9, 1.0);
                gl_FragColor = vec4(color, alpha * vBrightness);
            }
        `;

        this.starProgram = this.createProgram(gl, vsSource, fsSource);
        if (!this.starProgram) return false;

        this.starAttributes = {
            position: gl.getAttribLocation(this.starProgram, 'aPosition'),
            size: gl.getAttribLocation(this.starProgram, 'aSize'),
            brightness: gl.getAttribLocation(this.starProgram, 'aBrightness'),
        };

        this.starUniforms = {
            resolution: gl.getUniformLocation(this.starProgram, 'uResolution'),
            time: gl.getUniformLocation(this.starProgram, 'uTime'),
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

        // Quad buffer for Sun
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);

        // Star buffers
        this.starBuffers.position = gl.createBuffer();
        this.starBuffers.size = gl.createBuffer();
        this.starBuffers.brightness = gl.createBuffer();
    }

    allocateStars(count) {
        this.maxStars = count;
        this.starCount = 0;
        this.starData = {
            position: new Float32Array(count * 2),
            size: new Float32Array(count),
            brightness: new Float32Array(count),
        };
    }

    uploadStars(stars) {
        const gl = this.gl;
        const count = Math.min(stars.length, this.maxStars);
        this.starCount = count;

        for (let i = 0; i < count; i++) {
            this.starData.position[i * 2] = stars[i].x;
            this.starData.position[i * 2 + 1] = stars[i].y;
            this.starData.size[i] = stars[i].size;
            this.starData.brightness[i] = stars[i].brightness;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this.starData.position, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, this.starData.size, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.brightness);
        gl.bufferData(gl.ARRAY_BUFFER, this.starData.brightness, gl.DYNAMIC_DRAW);
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
        if (!gl) return;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 1. Render Stars
        if (this.starCount > 0 && this.starProgram) {
            gl.useProgram(this.starProgram);
            gl.uniform2f(this.starUniforms.resolution, this.canvas.width, this.canvas.height);
            gl.uniform1f(this.starUniforms.time, time);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.position);
            gl.enableVertexAttribArray(this.starAttributes.position);
            gl.vertexAttribPointer(this.starAttributes.position, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.size);
            gl.enableVertexAttribArray(this.starAttributes.size);
            gl.vertexAttribPointer(this.starAttributes.size, 1, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.brightness);
            gl.enableVertexAttribArray(this.starAttributes.brightness);
            gl.vertexAttribPointer(this.starAttributes.brightness, 1, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, this.starCount);
        }

        // 2. Render Sun
        if (this.program) {
            gl.useProgram(this.program);

            gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
            gl.uniform1f(this.uniforms.time, time);

            const x = params.x !== undefined ? params.x : 0.0;
            const y = params.y !== undefined ? params.y : 0.0;
            gl.uniform2f(this.uniforms.position, x, y);

            gl.uniform1f(this.uniforms.radius, params.radius || 0.25);

            const cTop = params.colorTop || [1.0, 0.8, 0.0];
            const cBot = params.colorBottom || [1.0, 0.0, 0.5];

            gl.uniform3f(this.uniforms.colorTop, cTop[0], cTop[1], cTop[2]);
            gl.uniform3f(this.uniforms.colorBottom, cBot[0], cBot[1], cBot[2]);

            gl.uniform1f(this.uniforms.stripeCount, params.stripeCount || 40.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
            gl.enableVertexAttribArray(this.attributes.position);
            gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }
}
