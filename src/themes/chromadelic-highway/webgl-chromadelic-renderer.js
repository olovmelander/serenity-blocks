/**
 * WebGL Chromadelic Renderer - GPU-accelerated rendering for Chromadelic Highway Theme
 *
 * Features:
 * - Multi-layered rainbow wave system with dynamic glow
 * - High performance particle system for sparkles and stars
 * - Shockwave and ripple effects
 */

export default class WebGLChromadelicRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.isWebGL2 = false;

        // Wave Program
        this.waveProgram = null;
        this.waveBuffers = {};
        this.waveUniforms = {};
        this.waveAttributes = {};

        // Particle Program (Sparkles & Stars)
        this.particleProgram = null;
        this.particleBuffers = {};
        this.particleUniforms = {};
        this.particleAttributes = {};

        // Data arrays for particles
        this.particleData = new Float32Array(2000 * 8); // Max 2000 particles, 8 floats per particle
    }

    init() {
        // Try WebGL 2 first
        let gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false,
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glowy look

        if (!this.initWaveShaders()) return false;
        if (!this.initParticleShaders()) return false;

        this.initBuffers();

        return true;
    }

    createProgram(vsSource, fsSource) {
        const { gl } = this;
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

    initWaveShaders() {
        const { gl } = this;
        const { isWebGL2 } = this;

        // Full screen quad vertex shader
        const vsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec2 aPosition;
            out vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        ` : `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        // Rainbow Road Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 vUv;
            out vec4 outColor;
            
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWaveAmplitude; // Controls Road Width
            uniform float uWaveFrequency; // Controls Curve Intensity
            uniform float uWaveSpeed;     // Controls Speed
            uniform float uPulseIntensity;
            
            // Rainbow palette
            vec3 getRainbowColor(float t) {
                vec3 c = vec3(0.0);
                float x = fract(t) * 6.0;
                if(x < 1.0) c = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), x);
                else if(x < 2.0) c = mix(vec3(1.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), x - 1.0);
                else if(x < 3.0) c = mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 1.0), x - 2.0);
                else if(x < 4.0) c = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 0.0, 1.0), x - 3.0);
                else if(x < 5.0) c = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 1.0), x - 4.0);
                else c = mix(vec3(1.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), x - 5.0);
                return c;
            }

            void main() {
                vec2 p = vUv * 2.0 - 1.0; // -1 to 1
                float horizon = 0.2;
                float fov = 0.8;
                
                // --- TUNNEL BACKGROUND ---
                // Calculate tunnel coordinates
                vec2 tUV = p - vec2(0.0, horizon);
                float tR = length(tUV);
                float tZ = 1.0 / max(0.001, tR); // Depth based on radius
                
                // Dynamic Curve
                float curveTime = uTime * 0.01;
                float curve = sin(tZ * 0.1 - curveTime) * 2.0;
                curve += sin(tZ * 0.25 + curveTime * 1.5) * 1.0;
                float curveIntensity = uWaveFrequency * 150.0;
                
                // Shift tunnel UVs to follow the curve
                // We shift X based on Z to simulate the curved path
                tUV.x -= (curve * curveIntensity) / tZ;
                
                // Recalculate polar coords after shift for pattern
                float tAngle = atan(tUV.y, tUV.x);
                float tRadius = length(tUV);
                
                // Tunnel Pattern
                float tSpeed = uTime * uWaveSpeed * 0.5;
                float tPos = tZ + tSpeed;
                
                // Retro Grid
                float gridRing = smoothstep(0.8, 0.95, sin(tPos * 3.0)); 
                float gridLine = smoothstep(0.96, 0.99, sin(tAngle * 10.0 + tPos * 0.2));
                
                // Dark colorful background
                vec3 tunnelColor = vec3(0.02, 0.0, 0.08); // Deep purple/blue void
                
                // Rainbow Grid
                vec3 gridColor = getRainbowColor(tPos * 0.02);
                tunnelColor += gridColor * (gridRing * 0.3 + gridLine * 0.5);
                
                // Pulse
                tunnelColor += vec3(uPulseIntensity * 0.1);
                
                // Distance Fade (Dark center)
                tunnelColor *= smoothstep(40.0, 5.0, tZ);
                
                vec4 finalColor = vec4(tunnelColor, 1.0);

                // --- ROAD RENDERING ---
                if (p.y < horizon) {
                    float z = fov / (horizon - p.y); // Depth projection for floor
                    
                    // Recalculate curve for road depth (z)
                    float rCurve = sin(z * 0.1 - curveTime) * 2.0;
                    rCurve += sin(z * 0.25 + curveTime * 1.5) * 1.0;
                    
                    float roadX = p.x * z - rCurve * curveIntensity;
                    
                    // Road Width
                    float width = uWaveAmplitude * 0.05; 
                    float dist = abs(roadX);
                    float edge = smoothstep(width, width * 0.85, dist);
                    
                    if (edge > 0.01) {
                        float roadV = z + uTime * uWaveSpeed * 0.5;
                        vec3 color = getRainbowColor(roadV * 0.05);
                        
                        float strip = sin(roadX * 20.0 / width);
                        color += strip * 0.05;
                        
                        float tube = sqrt(1.0 - pow(dist / width, 2.0));
                        color *= (0.4 + 0.6 * tube);
                        color += vec3(uPulseIntensity * 0.3);
                        
                        float fog = smoothstep(20.0, 5.0, z);
                        
                        // Blend road onto tunnel
                        finalColor = mix(finalColor, vec4(color, 1.0), edge * fog * 0.95);
                    }
                }
                
                outColor = finalColor;
            }
        ` : `
            precision highp float;
            
            varying vec2 vUv;
            
            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWaveAmplitude;
            uniform float uWaveFrequency;
            uniform float uWaveSpeed;
            uniform float uPulseIntensity;
            
            vec3 getRainbowColor(float t) {
                vec3 c = vec3(0.0);
                float x = fract(t) * 6.0;
                if(x < 1.0) c = mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), x);
                else if(x < 2.0) c = mix(vec3(1.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), x - 1.0);
                else if(x < 3.0) c = mix(vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 1.0), x - 2.0);
                else if(x < 4.0) c = mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 0.0, 1.0), x - 3.0);
                else if(x < 5.0) c = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 1.0), x - 4.0);
                else c = mix(vec3(1.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), x - 5.0);
                return c;
            }

            void main() {
                vec2 p = vUv * 2.0 - 1.0;
                float horizon = 0.2;
                float fov = 0.8;
                
                // --- TUNNEL BACKGROUND ---
                vec2 tUV = p - vec2(0.0, horizon);
                float tR = length(tUV);
                float tZ = 1.0 / max(0.001, tR);
                
                float curveTime = uTime * 0.01;
                float curve = sin(tZ * 0.1 - curveTime) * 2.0;
                curve += sin(tZ * 0.25 + curveTime * 1.5) * 1.0;
                float curveIntensity = uWaveFrequency * 150.0;
                
                tUV.x -= (curve * curveIntensity) / tZ;
                
                float tAngle = atan(tUV.y, tUV.x);
                
                float tSpeed = uTime * uWaveSpeed * 0.5;
                float tPos = tZ + tSpeed;
                
                float gridRing = smoothstep(0.8, 0.95, sin(tPos * 3.0));
                float gridLine = smoothstep(0.96, 0.99, sin(tAngle * 10.0 + tPos * 0.2));
                
                vec3 tunnelColor = vec3(0.02, 0.0, 0.08);
                vec3 gridColor = getRainbowColor(tPos * 0.02);
                tunnelColor += gridColor * (gridRing * 0.3 + gridLine * 0.5);
                tunnelColor += vec3(uPulseIntensity * 0.1);
                tunnelColor *= smoothstep(40.0, 5.0, tZ);
                
                vec4 finalColor = vec4(tunnelColor, 1.0);
                
                // --- ROAD RENDERING ---
                if (p.y < horizon) {
                    float z = fov / (horizon - p.y);
                    
                    float rCurve = sin(z * 0.1 - curveTime) * 2.0;
                    rCurve += sin(z * 0.25 + curveTime * 1.5) * 1.0;
                    
                    float roadX = p.x * z - rCurve * curveIntensity;
                    
                    float width = uWaveAmplitude * 0.05;
                    float dist = abs(roadX);
                    float edge = smoothstep(width, width * 0.85, dist);
                    
                    if (edge > 0.01) {
                        float roadV = z + uTime * uWaveSpeed * 0.5;
                        vec3 color = getRainbowColor(roadV * 0.05);
                        
                        float strip = sin(roadX * 20.0 / width);
                        color += strip * 0.05;
                        
                        float tube = sqrt(1.0 - pow(dist / width, 2.0));
                        color *= (0.4 + 0.6 * tube);
                        
                        color += vec3(uPulseIntensity * 0.3);
                        
                        float fog = smoothstep(20.0, 5.0, z);
                        
                        finalColor = mix(finalColor, vec4(color, 1.0), edge * fog * 0.95);
                    }
                }
                
                gl_FragColor = finalColor;
            }
        `;

        this.waveProgram = this.createProgram(vsSource, fsSource);
        if (!this.waveProgram) return false;

        this.waveAttributes = {
            position: gl.getAttribLocation(this.waveProgram, 'aPosition'),
        };

        this.waveUniforms = {
            time: gl.getUniformLocation(this.waveProgram, 'uTime'),
            resolution: gl.getUniformLocation(this.waveProgram, 'uResolution'),
            waveAmplitude: gl.getUniformLocation(this.waveProgram, 'uWaveAmplitude'),
            waveFrequency: gl.getUniformLocation(this.waveProgram, 'uWaveFrequency'),
            waveSpeed: gl.getUniformLocation(this.waveProgram, 'uWaveSpeed'),
            pulseIntensity: gl.getUniformLocation(this.waveProgram, 'uPulseIntensity'),
        };

        return true;
    }

    initParticleShaders() {
        const { gl } = this;
        const { isWebGL2 } = this;

        // Particle Vertex Shader
        const vsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 aPosition; // Quad vertex position (-1 to 1)
            in vec2 aCenter;   // Particle center position
            in float aSize;    // Particle size
            in vec3 aColor;    // Particle color
            in float aAlpha;   // Particle alpha
            in float aType;    // 0=Glow, 1=Ring, 2=Beam
            
            uniform vec2 uResolution;
            
            out vec2 vUv;
            out vec3 vColor;
            out float vAlpha;
            out float vType;
            
            void main() {
                vUv = aPosition;
                vColor = aColor;
                vAlpha = aAlpha;
                vType = aType;
                
                vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
                vec2 size = vec2(aSize) / uResolution * 2.0;
                
                if (aType > 1.5) { // Beam
                    size.y *= 10.0; // Stretch vertically
                }
                
                vec2 pos = (aCenter * 2.0 - 1.0) + aPosition * size * aspect;
                gl_Position = vec4(pos, 0.0, 1.0);
            }
        ` : `
            precision highp float;
            
            attribute vec2 aPosition;
            attribute vec2 aCenter;
            attribute float aSize;
            attribute vec3 aColor;
            attribute float aAlpha;
            attribute float aType;
            
            uniform vec2 uResolution;
            
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            varying float vType;
            
            void main() {
                vUv = aPosition;
                vColor = aColor;
                vAlpha = aAlpha;
                vType = aType;
                
                vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
                vec2 size = vec2(aSize) / uResolution * 2.0;
                
                if (aType > 1.5) { // Beam
                    size.y *= 10.0;
                }
                
                vec2 pos = (aCenter * 2.0 - 1.0) + aPosition * size * aspect;
                gl_Position = vec4(pos, 0.0, 1.0);
            }
        `;

        // Particle Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 vUv;
            in vec3 vColor;
            in float vAlpha;
            in float vType;
            
            out vec4 outColor;
            
            void main() {
                float dist = length(vUv);
                float alpha = 0.0;
                
                if (vType < 0.5) { // Glow (Sparkle/Star)
                    if (dist > 1.0) discard;
                    float glow = pow(1.0 - dist, 2.0);
                    float core = smoothstep(0.2, 0.0, dist);
                    alpha = vAlpha * (glow + core);
                    outColor = vec4(vColor * (glow * 1.5 + core), alpha);
                } 
                else if (vType < 1.5) { // Ring (Shockwave/Ripple)
                    if (dist > 1.0) discard;
                    float ring = smoothstep(0.8, 1.0, dist) * smoothstep(1.0, 0.8, dist); // Thin ring
                    // Thicker ring with fade
                    float thickness = 0.15;
                    float r = abs(dist - 0.85);
                    float shape = smoothstep(thickness, 0.0, r);
                    alpha = vAlpha * shape;
                    outColor = vec4(vColor, alpha);
                }
                else { // Beam
                    // vUv is -1 to 1. Beam is a vertical bar.
                    float xDist = abs(vUv.x);
                    float yDist = abs(vUv.y);
                    if (xDist > 1.0 || yDist > 1.0) discard;
                    
                    float core = smoothstep(1.0, 0.0, xDist);
                    float fade = smoothstep(1.0, 0.0, yDist);
                    alpha = vAlpha * core * fade;
                    outColor = vec4(vColor, alpha);
                }
            }
        ` : `
            precision highp float;
            
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            varying float vType;
            
            void main() {
                float dist = length(vUv);
                float alpha = 0.0;
                
                if (vType < 0.5) {
                    if (dist > 1.0) discard;
                    float glow = pow(1.0 - dist, 2.0);
                    float core = smoothstep(0.2, 0.0, dist);
                    alpha = vAlpha * (glow + core);
                    gl_FragColor = vec4(vColor * (glow * 1.5 + core), alpha);
                }
                else if (vType < 1.5) {
                    if (dist > 1.0) discard;
                    float r = abs(dist - 0.85);
                    float shape = smoothstep(0.15, 0.0, r);
                    alpha = vAlpha * shape;
                    gl_FragColor = vec4(vColor, alpha);
                }
                else {
                    float xDist = abs(vUv.x);
                    float yDist = abs(vUv.y);
                    if (xDist > 1.0 || yDist > 1.0) discard;
                    float core = smoothstep(1.0, 0.0, xDist);
                    float fade = smoothstep(1.0, 0.0, yDist);
                    alpha = vAlpha * core * fade;
                    gl_FragColor = vec4(vColor, alpha);
                }
            }
        `;

        this.particleProgram = this.createProgram(vsSource, fsSource);
        if (!this.particleProgram) return false;

        this.particleAttributes = {
            position: gl.getAttribLocation(this.particleProgram, 'aPosition'),
            center: gl.getAttribLocation(this.particleProgram, 'aCenter'),
            size: gl.getAttribLocation(this.particleProgram, 'aSize'),
            color: gl.getAttribLocation(this.particleProgram, 'aColor'),
            alpha: gl.getAttribLocation(this.particleProgram, 'aAlpha'),
            type: gl.getAttribLocation(this.particleProgram, 'aType'),
        };

        this.particleUniforms = {
            resolution: gl.getUniformLocation(this.particleProgram, 'uResolution'),
        };

        return true;
    }

    initBuffers() {
        const { gl } = this;

        // Wave Quad (Full screen)
        this.waveBuffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.waveBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);

        // Particle Quad (Instance geometry)
        this.particleBuffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ]), gl.STATIC_DRAW);

        // Particle Instance Data Buffer
        this.particleBuffers.data = gl.createBuffer();
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, params) {
        const { gl } = this;
        if (!gl) return;

        // Clear
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 1. Render Waves
        this.renderWaves(time, params);

        // 2. Render Particles
        if (params.particles && params.particles.length > 0) {
            this.renderParticles(params.particles);
        }
    }

    renderWaves(time, params) {
        const { gl } = this;
        gl.useProgram(this.waveProgram);

        gl.uniform1f(this.waveUniforms.time, time);
        gl.uniform2f(this.waveUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.waveUniforms.waveAmplitude, params.amplitude || 50.0);
        gl.uniform1f(this.waveUniforms.waveFrequency, params.frequency || 0.002);
        gl.uniform1f(this.waveUniforms.waveSpeed, params.speed || 1.0);
        gl.uniform1f(this.waveUniforms.pulseIntensity, params.pulseIntensity || 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.waveBuffers.position);
        gl.enableVertexAttribArray(this.waveAttributes.position);
        gl.vertexAttribPointer(this.waveAttributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    renderParticles(particles) {
        const { gl } = this;
        const ext = gl.getExtension('ANGLE_instanced_arrays');

        if (!this.isWebGL2 && !ext) return;

        gl.useProgram(this.particleProgram);
        gl.uniform2f(this.particleUniforms.resolution, this.canvas.width, this.canvas.height);

        // Update particle data buffer
        let count = 0;
        const data = this.particleData;

        // Ensure buffer is large enough
        if (this.particleData.length < particles.length * 8) {
            this.particleData = new Float32Array(particles.length * 8);
        }

        for (let i = 0; i < particles.length && count < 2000; i++) {
            const p = particles[i];
            const offset = count * 8;

            data[offset] = p.x;
            data[offset + 1] = p.y;
            data[offset + 2] = p.size;
            data[offset + 3] = p.color[0];
            data[offset + 4] = p.color[1];
            data[offset + 5] = p.color[2];
            data[offset + 6] = p.alpha;
            data[offset + 7] = p.type || 0;

            count++;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.data);
        gl.bufferData(gl.ARRAY_BUFFER, this.particleData.subarray(0, count * 8), gl.DYNAMIC_DRAW);

        // Bind Quad Geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.position);
        gl.enableVertexAttribArray(this.particleAttributes.position);
        gl.vertexAttribPointer(this.particleAttributes.position, 2, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.position, 0);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.position, 0);

        // Bind Instance Data
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.data);

        const stride = 32; // 8 * 4 bytes

        // Center (2 floats)
        gl.enableVertexAttribArray(this.particleAttributes.center);
        gl.vertexAttribPointer(this.particleAttributes.center, 2, gl.FLOAT, false, stride, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.center, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.center, 1);

        // Size (1 float)
        gl.enableVertexAttribArray(this.particleAttributes.size);
        gl.vertexAttribPointer(this.particleAttributes.size, 1, gl.FLOAT, false, stride, 8);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.size, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.size, 1);

        // Color (3 floats)
        gl.enableVertexAttribArray(this.particleAttributes.color);
        gl.vertexAttribPointer(this.particleAttributes.color, 3, gl.FLOAT, false, stride, 12);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.color, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.color, 1);

        // Alpha (1 float)
        gl.enableVertexAttribArray(this.particleAttributes.alpha);
        gl.vertexAttribPointer(this.particleAttributes.alpha, 1, gl.FLOAT, false, stride, 24);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.alpha, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.alpha, 1);

        // Type (1 float)
        gl.enableVertexAttribArray(this.particleAttributes.type);
        gl.vertexAttribPointer(this.particleAttributes.type, 1, gl.FLOAT, false, stride, 28);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.type, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.type, 1);

        // Draw
        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        } else {
            ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
        }
    }

    dispose() {
        const { gl } = this;
        if (!gl) return;

        // Delete programs
        if (this.waveProgram) gl.deleteProgram(this.waveProgram);
        if (this.particleProgram) gl.deleteProgram(this.particleProgram);

        // Delete buffers
        Object.values(this.waveBuffers).forEach((buffer) => gl.deleteBuffer(buffer));
        Object.values(this.particleBuffers).forEach((buffer) => gl.deleteBuffer(buffer));

        // Force lose context to prevent hitting browser limits
        const ext = gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();

        this.gl = null;
    }
}
