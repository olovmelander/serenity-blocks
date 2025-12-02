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
    }

    init() {
        // Try WebGL 2 first for better shader support (dynamic indexing)
        let gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false, // Retro feel
            preserveDrawingBuffer: false,
        });

        if (!gl) {
            console.warn('WebGL 2 not supported, falling back to WebGL 1');
            gl = this.canvas.getContext('webgl', {
                alpha: true,
                premultipliedAlpha: false,
                antialias: false,
                preserveDrawingBuffer: false,
            }) || this.canvas.getContext('experimental-webgl');
        }

        if (!gl) {
            console.warn('WebGL not supported');
            return false;
        }

        this.gl = gl;
        this.isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);

        // Enable blending
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for neon glow

        if (!this.initGridShaders()) return false;

        this.initBuffers();

        return true;
    }

    initGridShaders() {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

        // Full screen quad vertex shader
        let vsSource;
        if (isWebGL2) {
            vsSource = `#version 300 es
                precision highp float;
                in vec2 aPosition;
                out vec2 vUv;
                void main() {
                    vUv = aPosition * 0.5 + 0.5;
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
            `;
        } else {
            vsSource = `
                precision highp float;
                attribute vec2 aPosition;
                varying vec2 vUv;
                void main() {
                    vUv = aPosition * 0.5 + 0.5;
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
            `;
        }

        // Procedural Grid Fragment Shader
        let fsSource;
        if (isWebGL2) {
            fsSource = `#version 300 es
                precision highp float;
                
                in vec2 vUv;
                out vec4 outColor;
                
                uniform float uTime;
                uniform vec2 uResolution;
                uniform float uSpeed;
                uniform vec3 uGridColor;
                uniform float uGlowIntensity;
                uniform float uBendFactor;
                
                uniform vec3 uHighlights[60];
                uniform vec3 uHighlightColors[60];

                float random(vec2 st) {
                    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
                }

                void main() {
                    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                    float horizon = 0.4; 
                    
                    if (uv.y > horizon) {
                        discard;
                    }
                    
                    float camHeight = 1.0;
                    float z = camHeight / (horizon - uv.y);
                    float curve = (1.0 - z * 0.05) * uBendFactor; 
                    float x = uv.x * z * 2.0;
                    
                    float timeOffset = uTime * uSpeed;
                    float worldZ = z + timeOffset;
                    
                    float terrain = sin(worldZ * 0.1) * 0.5 + sin(x * 0.5) * 0.5;
                    float warpedX = x + sin(worldZ * 0.2) * z * 0.1;
                    
                    float gridSize = 1.0;
                    vec2 gridUV = vec2(warpedX, worldZ) / gridSize;
                    vec2 gridFract = fract(gridUV);
                    vec2 cellID = floor(gridUV);
                    
                    float lineThickness = 0.02 * z; 
                    float lineX = smoothstep(0.0, lineThickness, gridFract.x) - smoothstep(1.0 - lineThickness, 1.0, gridFract.x);
                    float lineZ = smoothstep(0.0, lineThickness, gridFract.y) - smoothstep(1.0 - lineThickness, 1.0, gridFract.y);
                    float lines = 1.0 - (lineX * lineZ);
                    
                    float bloomThickness = lineThickness * 4.0;
                    float bloomX = smoothstep(0.0, bloomThickness, gridFract.x) - smoothstep(1.0 - bloomThickness, 1.0, gridFract.x);
                    float bloomZ = smoothstep(0.0, bloomThickness, gridFract.y) - smoothstep(1.0 - bloomThickness, 1.0, gridFract.y);
                    float bloom = (1.0 - (bloomX * bloomZ)) * 0.5;
                    
                    float fog = 1.0 - smoothstep(20.0, 200.0, z);
                    
                    float noise = random(floor(gridUV));
                    float sparkle = step(0.98, noise) * sin(uTime * 10.0) * 0.5;
                    
                    vec3 farColor = vec3(0.5, 0.0, 1.0);
                    vec3 nearColor = uGridColor;
                    float colorMix = smoothstep(0.0, 50.0, z);
                    vec3 finalColor = mix(nearColor, farColor, colorMix);
                    
                    float reflectionWidth = 1.0 + z * 0.1;
                    float reflection = smoothstep(reflectionWidth, 0.0, abs(uv.x * z));
                    reflection *= 0.3;
                    
                    vec3 activeHighlightColor = vec3(0.0);
                    float maxIntensity = 0.0;
                    
                    for (int i = 0; i < 60; i++) {
                        if (uHighlights[i].z > 0.01) {
                            if (abs(cellID.x - uHighlights[i].x) < 0.1 && abs(cellID.y - uHighlights[i].y) < 0.1) {
                                if (uHighlights[i].z > maxIntensity) {
                                    maxIntensity = uHighlights[i].z;
                                    activeHighlightColor = uHighlightColors[i];
                                }
                            }
                        }
                    }
                    
                    float cellFill = maxIntensity * 0.6;
                    
                    vec3 color = (finalColor * (lines + bloom + sparkle) + reflection * nearColor) * fog * uGlowIntensity;
                    color += activeHighlightColor * cellFill * fog;
                    
                    float alpha = (lines + bloom + sparkle + reflection + cellFill) * fog;
                    
                    outColor = vec4(color, alpha);
                }
            `;
        } else {
            // WebGL 1 Fallback (simplified to avoid loop issues)
            fsSource = `
                precision highp float;
                varying vec2 vUv;
                uniform float uTime;
                uniform vec2 uResolution;
                uniform float uSpeed;
                uniform vec3 uGridColor;
                uniform float uGlowIntensity;
                uniform float uBendFactor;
                // Reduced support for highlights in WebGL 1
                
                void main() {
                    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / uResolution.y;
                    float horizon = 0.4; 
                    if (uv.y > horizon) discard;
                    
                    float camHeight = 1.0;
                    float z = camHeight / (horizon - uv.y);
                    float x = uv.x * z * 2.0;
                    float timeOffset = uTime * uSpeed;
                    float worldZ = z + timeOffset;
                    
                    vec2 gridUV = vec2(x, worldZ);
                    vec2 gridFract = fract(gridUV);
                    
                    float lineThickness = 0.02 * z; 
                    float lineX = smoothstep(0.0, lineThickness, gridFract.x) - smoothstep(1.0 - lineThickness, 1.0, gridFract.x);
                    float lineZ = smoothstep(0.0, lineThickness, gridFract.y) - smoothstep(1.0 - lineThickness, 1.0, gridFract.y);
                    float lines = 1.0 - (lineX * lineZ);
                    
                    float fog = 1.0 - smoothstep(20.0, 200.0, z);
                    vec3 color = uGridColor * lines * fog * uGlowIntensity;
                    gl_FragColor = vec4(color, lines * fog);
                }
            `;
        }

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
            highlights: gl.getUniformLocation(this.gridProgram, 'uHighlights'),
            highlightColors: gl.getUniformLocation(this.gridProgram, 'uHighlightColors'),
        };

        return true;
    }

    // ... (rest of methods)

    render(time, gridParams) {
        const gl = this.gl;
        if (!gl) return;

        // Clear
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Render Grid (Foreground)
        gl.useProgram(this.gridProgram);
        gl.uniform1f(this.gridUniforms.time, time);
        gl.uniform2f(this.gridUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.gridUniforms.speed, gridParams.speed || 1.0);

        const color = gridParams.color || [1.0, 0.0, 0.4]; // Default hot pink
        gl.uniform3f(this.gridUniforms.gridColor, color[0], color[1], color[2]);

        gl.uniform1f(this.gridUniforms.glowIntensity, gridParams.glowIntensity || 1.0);
        gl.uniform1f(this.gridUniforms.bendFactor, gridParams.bendFactor || 0.0);

        // Pass highlights
        // Expects array of {x, y, intensity, color: [r,g,b]} objects
        const highlights = new Float32Array(180); // 60 * 3
        const highlightColors = new Float32Array(180); // 60 * 3

        if (gridParams.highlights && gridParams.highlights.length > 0) {
            for (let i = 0; i < Math.min(gridParams.highlights.length, 60); i++) {
                const h = gridParams.highlights[i];
                highlights[i * 3] = h.x;
                highlights[i * 3 + 1] = h.y;
                highlights[i * 3 + 2] = h.intensity;

                if (h.color) {
                    highlightColors[i * 3] = h.color[0];
                    highlightColors[i * 3 + 1] = h.color[1];
                    highlightColors[i * 3 + 2] = h.color[2];
                } else {
                    // Default cyan
                    highlightColors[i * 3] = 0.0;
                    highlightColors[i * 3 + 1] = 1.0;
                    highlightColors[i * 3 + 2] = 1.0;
                }
            }
        }
        gl.uniform3fv(this.gridUniforms.highlights, highlights);
        gl.uniform3fv(this.gridUniforms.highlightColors, highlightColors);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffers.position);
        gl.enableVertexAttribArray(this.gridAttributes.position);
        gl.vertexAttribPointer(this.gridAttributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

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
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }
}
