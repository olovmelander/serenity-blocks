/**
 * WebGL Synthwave Renderer - GPU-accelerated rendering for Synthwave Sunset Theme
 * 
 * Features:
 * - Procedural infinite grid with perspective and glow
 * - Retro star field
 * - High performance rendering
 */

export default class WebGLSynthwaveRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;

        // Grid Program
        this.gridProgram = null;
        this.gridBuffers = {};
        this.gridUniforms = {};
        this.gridAttributes = {};

        // Star Program (reused from Wolfhour concept but simplified)
        this.starProgram = null;
        this.starBuffers = {};
        this.starUniforms = {};
        this.starAttributes = {};

        // Data
        this.starCount = 0;
        this.maxStars = 2000;
        this.starData = null; // Float32Array for star data
    }

    init() {
        const gl = this.canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false, // Retro feel
            preserveDrawingBuffer: false,
        }) || this.canvas.getContext('experimental-webgl');

        if (!gl) {
            console.warn('WebGL not supported');
            return false;
        }

        this.gl = gl;

        // Enable blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for neon glow

        if (!this.initGridShaders()) return false;
        if (!this.initStarShaders()) return false;

        this.initBuffers();

        return true;
    }

    initGridShaders() {
        const gl = this.gl;

        // Full screen quad vertex shader
        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        // Procedural Grid Fragment Shader
        // Creates an infinite moving grid on a floor plane
        const fsSource = `
            precision highp float;
            
            varying vec2 vUv;
            
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uSpeed;
            uniform vec3 uGridColor;
            uniform float uGlowIntensity;
            uniform float uBendFactor; // For curvature effect
            
            // Pseudo-random function
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
                // Normalize coordinates -1 to 1
                vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                
                // Horizon height (0.0 is center)
                // Container is 40% height, City starts at 36% screen height
                // 36/40 = 0.9 -> 90% of container
                // UV.y is -0.5 to 0.5, so 90% is 0.4
                float horizon = 0.4; 
                
                // Sky/Ground separation
                if (uv.y > horizon) {
                    discard; // Don't draw grid in sky
                }
                
                // 3D Projection
                // Map screen UV to World Plane (y = 0)
                float camHeight = 1.0;
                float fov = 1.0;
                
                // Perspective projection math
                // z = camHeight / (horizon - uv.y)
                // x = uv.x * z / fov
                
                float z = camHeight / (horizon - uv.y);
                
                // Curvature effect (bend x based on distance)
                float curve = (1.0 - z * 0.05) * uBendFactor; 
                
                float x = uv.x * z * 2.0;
                
                // Movement
                float timeOffset = uTime * uSpeed;
                float worldZ = z + timeOffset;
                
                // Grid Logic
                float gridSize = 1.0;
                
                // Lines
                // Use fract to get repeating pattern
                vec2 gridUV = vec2(x, worldZ) / gridSize;
                vec2 gridFract = fract(gridUV);
                
                // Line thickness based on distance (thinner far away to avoid moire, but thicker close up)
                float lineThickness = 0.02 * z; 
                
                // Smoothstep for anti-aliased lines
                float lineX = smoothstep(0.0, lineThickness, gridFract.x) - smoothstep(1.0 - lineThickness, 1.0, gridFract.x);
                float lineZ = smoothstep(0.0, lineThickness, gridFract.y) - smoothstep(1.0 - lineThickness, 1.0, gridFract.y);
                
                // Invert to get lines
                float lines = 1.0 - (lineX * lineZ);
                
                // Fade out into distance (fog)
                // Extend fog further to ensure it reaches the buildings
                float fog = 1.0 - smoothstep(20.0, 200.0, z);
                
                // Add some variation/noise to the grid for "retro" feel
                float noise = random(floor(gridUV));
                float sparkle = step(0.98, noise) * sin(uTime * 10.0) * 0.5;
                
                vec3 color = uGridColor * (lines + sparkle) * fog * uGlowIntensity;
                
                // Alpha for blending
                float alpha = (lines + sparkle) * fog;
                
                gl_FragColor = vec4(color, alpha);
            }
        `;

        this.gridProgram = this.createProgram(vsSource, fsSource);
        if (!this.gridProgram) return false;

        this.gridAttributes = {
            position: gl.getAttribLocation(this.gridProgram, 'aPosition'),
        };

        this.gridUniforms = {
            time: gl.getUniformLocation(this.gridProgram, 'uTime'),
            resolution: gl.getUniformLocation(this.gridProgram, 'uResolution'),
            speed: gl.getUniformLocation(this.gridProgram, 'uSpeed'),
            gridColor: gl.getUniformLocation(this.gridProgram, 'uGridColor'),
            glowIntensity: gl.getUniformLocation(this.gridProgram, 'uGlowIntensity'),
            bendFactor: gl.getUniformLocation(this.gridProgram, 'uBendFactor'),
        };

        return true;
    }

    initStarShaders() {
        const gl = this.gl;

        // Simple point sprite shader for stars
        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            attribute float aSize;
            attribute float aBrightness;
            
            uniform vec2 uResolution;
            uniform float uTime;
            
            varying float vBrightness;
            
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                // Twinkle
                float twinkle = 0.8 + 0.2 * sin(uTime * 5.0 + aPosition.x * 0.1);
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
                
                // White/Blueish stars
                vec3 color = vec3(0.9, 0.9, 1.0);
                gl_FragColor = vec4(color * alpha * vBrightness, alpha * vBrightness);
            }
        `;

        this.starProgram = this.createProgram(vsSource, fsSource);
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

    createProgram(vsSource, fsSource) {
        const gl = this.gl;
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

        // Grid Quad (Full screen)
        this.gridBuffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);

        // Stars
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

    render(time, gridParams) {
        const gl = this.gl;
        if (!gl) return;

        // Clear
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 1. Render Stars (Background)
        if (this.starCount > 0) {
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

        // 2. Render Grid
        gl.useProgram(this.gridProgram);
        gl.uniform1f(this.gridUniforms.time, time);
        gl.uniform2f(this.gridUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.gridUniforms.speed, gridParams.speed || 1.0);

        const color = gridParams.color || [1.0, 0.0, 0.4]; // Default hot pink
        gl.uniform3f(this.gridUniforms.gridColor, color[0], color[1], color[2]);

        gl.uniform1f(this.gridUniforms.glowIntensity, gridParams.glowIntensity || 1.0);
        gl.uniform1f(this.gridUniforms.bendFactor, gridParams.bendFactor || 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffers.position);
        gl.enableVertexAttribArray(this.gridAttributes.position);
        gl.vertexAttribPointer(this.gridAttributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
}
