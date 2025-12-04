/**
 * WebGL Electric Dreams Renderer
 * 
 * Implements a high-performance "Lava Lamp" effect using metaballs in a fragment shader,
 * and a particle system for electric sparks.
 */

export default class WebGLElectricDreamsRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.isWebGL2 = false;

        // Background (Lava Lamp) Program
        this.bgProgram = null;
        this.bgBuffers = {};
        this.bgUniforms = {};
        this.bgAttributes = {};

        // Particle Program (Sparks)
        this.particleProgram = null;
        this.particleBuffers = {};
        this.particleUniforms = {};
        this.particleAttributes = {};

        // Particle Data
        this.maxParticles = 100;
        this.particleData = new Float32Array(this.maxParticles * 7); // x, y, size, r, g, b, a
        this.particles = [];
    }

    init() {
        // Try WebGL 2 first
        let gl = this.canvas.getContext('webgl2', {
            alpha: false, // Opaque background
            premultipliedAlpha: false,
            antialias: false,
        });

        if (!gl) {
            gl = this.canvas.getContext('webgl', {
                alpha: false,
                premultipliedAlpha: false,
                antialias: false,
            }) || this.canvas.getContext('experimental-webgl');
        }

        if (!gl) {
            console.warn('WebGL not supported');
            return false;
        }

        this.gl = gl;
        this.isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);

        // Enable blending for particles
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for electric look

        if (!this.initBackgroundShaders()) return false;
        if (!this.initParticleShaders()) return false;

        this.initBuffers();

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

    initBackgroundShaders() {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

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

        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 vUv;
            out vec4 outColor;
            
            uniform float uTime;
            uniform vec2 uResolution;
            
            // Vibrant "Electric Dreams" Palette based on reference image
            const vec3 COLORS[6] = vec3[](
                vec3(1.0, 0.0, 0.2), // Red/Pink
                vec3(0.0, 1.0, 0.2), // Green
                vec3(0.0, 0.6, 1.0), // Blue
                vec3(1.0, 0.0, 1.0), // Magenta
                vec3(0.0, 1.0, 1.0), // Cyan
                vec3(1.0, 0.9, 0.0)  // Yellow
            );
            
            uniform float uDeform;
            
            // Simplex Noise for smooth random movement
            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
            float snoise(vec2 v){
                const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1;
                i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod(i, 289.0);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m ;
                m = m*m ;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            
            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                uv.x *= uResolution.x / uResolution.y;
                
                // Domain warping for "liquid" deformation
                vec2 warpedUv = uv;
                warpedUv += vec2(
                    sin(uv.y * 3.0 + uTime * 0.3) * uDeform * 0.05,
                    cos(uv.x * 3.0 + uTime * 0.2) * uDeform * 0.05
                );

                float v = 0.0;
                vec3 colorAccum = vec3(0.0);
                
                // 15 Blobs
                for(int i = 0; i < 15; i++) {
                    float fi = float(i);
                    
                    // Noise-based movement for smooth, non-repetitive floating
                    // We sample noise at different offsets for each blob
                    // Slowed down significantly
                    float timeScale = uTime * 0.02;
                    float noiseX = snoise(vec2(timeScale * 0.5, fi * 10.0));
                    float noiseY = snoise(vec2(fi * 20.0, timeScale * 0.4));
                    
                    vec2 pos = vec2(
                        noiseX * 1.6, // Wide X range
                        noiseY * 1.0  // Y range
                    );
                    
                    // Add very slow vertical drift (lava lamp style)
                    pos.y += sin(uTime * 0.01 + fi) * 0.3;
                    
                    float d = length(warpedUv - pos);
                    
                    // Tighter falloff
                    float sizeFactor = 25.0 + sin(fi) * 10.0;
                    float w = 1.0 / (d * d * sizeFactor + 0.05);
                    v += w;
                    
                    // Color blending
                    int colorIdx = i % 5;
                    colorAccum += COLORS[colorIdx] * w;
                }
                
                vec3 finalColor = vec3(0.0);
                
                // Normalize color
                if (v > 0.0) {
                    finalColor = colorAccum / v;
                }
                
                // Background
                vec3 bgColor = vec3(0.0, 0.0, 0.05);
                
                // Thresholding - Sharp edges (Less blurry)
                float threshold = 0.8;
                // Very tight smoothstep for sharp, anti-aliased edges
                float alpha = smoothstep(threshold - 0.02, threshold, v);
                
                // Core
                float core = smoothstep(threshold, threshold + 1.5, v);
                vec3 blobColor = finalColor + vec3(0.15) * core;
                
                // Sharp Rim
                float rim = smoothstep(threshold, threshold + 0.05, v) * (1.0 - smoothstep(threshold + 0.05, threshold + 0.15, v));
                blobColor += vec3(0.4) * rim;

                // Final mix with background
                outColor = vec4(mix(bgColor, blobColor, alpha), 1.0);
            }
        ` : `
            precision highp float;
            
            varying vec2 vUv;
            
            uniform float uTime;
            uniform vec2 uResolution;
            
            // Palette from reference image (Green, Blue, Magenta, Red, Orange)
            const vec3 COLORS[5] = vec3[](
                vec3(0.0, 1.0, 0.2), // Green
                vec3(0.0, 0.5, 1.0), // Blue
                vec3(1.0, 0.0, 1.0), // Magenta
                vec3(1.0, 0.0, 0.2), // Red
                vec3(1.0, 0.5, 0.0)  // Orange
            );
            
            uniform float uDeform;
            
            // Simplex Noise for smooth random movement
            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
            float snoise(vec2 v){
                const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1;
                i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod(i, 289.0);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m ;
                m = m*m ;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }
            
            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                uv.x *= uResolution.x / uResolution.y;
                
                vec2 warpedUv = uv;
                warpedUv += vec2(sin(uv.y * 3.0 + uTime * 0.3), cos(uv.x * 3.0 + uTime * 0.2)) * uDeform * 0.05;

                float v = 0.0;
                vec3 colorAccum = vec3(0.0);
                
                // 15 Blobs
                for(int i = 0; i < 15; i++) {
                    float fi = float(i);
                    
                    float timeScale = uTime * 0.02;
                    float noiseX = snoise(vec2(timeScale * 0.5, fi * 10.0));
                    float noiseY = snoise(vec2(fi * 20.0, timeScale * 0.4));
                    
                    vec2 pos = vec2(noiseX * 1.6, noiseY * 1.0);
                    pos.y += sin(uTime * 0.01 + fi) * 0.3;
                    
                    float d = length(warpedUv - pos);
                    float sizeFactor = 25.0 + sin(fi) * 10.0;
                    float w = 1.0 / (d * d * sizeFactor + 0.05);
                    
                    v += w;
                    
                    int colorIdx = i - 5 * (i / 5); 
                    if (colorIdx == 0) colorAccum += COLORS[0] * w;
                    else if (colorIdx == 1) colorAccum += COLORS[1] * w;
                    else if (colorIdx == 2) colorAccum += COLORS[2] * w;
                    else if (colorIdx == 3) colorAccum += COLORS[3] * w;
                    else colorAccum += COLORS[4] * w;
                }
                
                vec3 finalColor = vec3(0.0);
                if (v > 0.0) finalColor = colorAccum / v;
                
                vec3 bgColor = vec3(0.0, 0.0, 0.05);
                
                // Thresholding - Sharp edges
                float threshold = 0.8;
                // Very tight smoothstep
                float alpha = smoothstep(threshold - 0.02, threshold, v);
                
                float core = smoothstep(threshold, threshold + 1.5, v);
                vec3 blobColor = finalColor + vec3(0.15) * core;
                
                // Sharp Rim
                float rim = smoothstep(threshold, threshold + 0.05, v) * (1.0 - smoothstep(threshold + 0.05, threshold + 0.15, v));
                blobColor += vec3(0.4) * rim;

                gl_FragColor = vec4(mix(bgColor, blobColor, alpha), 1.0);
            }
        `;

        this.bgProgram = this.createProgram(vsSource, fsSource);
        if (!this.bgProgram) return false;

        this.bgAttributes = {
            position: gl.getAttribLocation(this.bgProgram, 'aPosition'),
        };

        this.bgUniforms = {
            time: gl.getUniformLocation(this.bgProgram, 'uTime'),
            resolution: gl.getUniformLocation(this.bgProgram, 'uResolution'),
            deform: gl.getUniformLocation(this.bgProgram, 'uDeform'),
        };

        return true;
    }

    initParticleShaders() {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

        const vsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 aPosition;
            in vec2 aCenter;
            in float aSize;
            in vec3 aColor;
            in float aAlpha;
            
            uniform vec2 uResolution;
            
            out vec2 vUv;
            out vec3 vColor;
            out float vAlpha;
            
            void main() {
                vUv = aPosition;
                vColor = aColor;
                vAlpha = aAlpha;
                
                vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
                vec2 size = vec2(aSize) / uResolution * 2.0;
                
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
            
            uniform vec2 uResolution;
            
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            
            void main() {
                vUv = aPosition;
                vColor = aColor;
                vAlpha = aAlpha;
                
                vec2 aspect = vec2(uResolution.y / uResolution.x, 1.0);
                vec2 size = vec2(aSize) / uResolution * 2.0;
                
                vec2 pos = (aCenter * 2.0 - 1.0) + aPosition * size * aspect;
                gl_Position = vec4(pos, 0.0, 1.0);
            }
        `;

        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            
            in vec2 vUv;
            in vec3 vColor;
            in float vAlpha;
            
            out vec4 outColor;
            
            void main() {
                float dist = length(vUv);
                if (dist > 1.0) discard;
                
                // Electric spark look (sharp core, soft glow)
                float glow = pow(1.0 - dist, 3.0);
                float core = smoothstep(0.3, 0.0, dist);
                
                outColor = vec4(vColor, vAlpha * (glow + core));
            }
        ` : `
            precision highp float;
            
            varying vec2 vUv;
            varying vec3 vColor;
            varying float vAlpha;
            
            void main() {
                float dist = length(vUv);
                if (dist > 1.0) discard;
                
                float glow = pow(1.0 - dist, 3.0);
                float core = smoothstep(0.3, 0.0, dist);
                
                gl_FragColor = vec4(vColor, vAlpha * (glow + core));
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
        };

        this.particleUniforms = {
            resolution: gl.getUniformLocation(this.particleProgram, 'uResolution'),
        };

        return true;
    }

    initBuffers() {
        const gl = this.gl;

        // Quad Buffer
        this.bgBuffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1
        ]), gl.STATIC_DRAW);

        // Particle Data Buffer
        this.particleBuffers.data = gl.createBuffer();
        this.particleBuffers.position = this.bgBuffers.position; // Reuse quad
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, deform = 0.0) {
        this.currentDeform = deform;
        const gl = this.gl;
        if (!gl) return;

        // 1. Render Background
        gl.useProgram(this.bgProgram);
        gl.uniform1f(this.bgUniforms.time, time);
        gl.uniform2f(this.bgUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.bgUniforms.deform, this.currentDeform || 0.0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuffers.position);
        gl.enableVertexAttribArray(this.bgAttributes.position);
        gl.vertexAttribPointer(this.bgAttributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 2. Render Particles
        this.updateParticles(time);
        this.renderParticles();
    }

    updateParticles(time) {
        // Simple particle system logic
        // Spawn new particles occasionally
        if (Math.random() < 0.05) {
            this.spawnParticle();
        }

        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            p.life -= 0.01;
            p.x += p.vx;
            p.y += p.vy;
            p.alpha = Math.sin(p.life * Math.PI); // Fade in/out

            if (p.life <= 0) {
                this.particles.splice(i, 1);
                i--;
            }
        }
    }

    spawnParticle() {
        if (this.particles.length >= this.maxParticles) return;

        // Randomly choose between Cyan, Magenta, Yellow, Green
        const r = Math.random();
        let color;
        if (r < 0.25) color = [0.0, 1.0, 1.0]; // Cyan
        else if (r < 0.5) color = [1.0, 0.0, 1.0]; // Magenta
        else if (r < 0.75) color = [1.0, 1.0, 0.0]; // Yellow
        else color = [0.0, 1.0, 0.0]; // Green

        this.particles.push({
            x: Math.random(),
            y: Math.random(),
            vx: (Math.random() - 0.5) * 0.002,
            vy: (Math.random() - 0.5) * 0.002,
            size: Math.random() * 20 + 5,
            color: color,
            alpha: 0.0,
            life: 1.0
        });
    }

    spawnExplosion(x, y, count = 10) {
        // x, y are 0-1 normalized coordinates
        for (let i = 0; i < count; i++) {
            if (this.particles.length >= this.maxParticles) {
                // Recycle oldest if full
                this.particles.shift();
            }

            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 0.01 + 0.005;

            const r = Math.random();
            let color;
            if (r < 0.25) color = [0.0, 1.0, 1.0];
            else if (r < 0.5) color = [1.0, 0.0, 1.0];
            else if (r < 0.75) color = [1.0, 1.0, 0.0];
            else color = [0.0, 1.0, 0.0];

            this.particles.push({
                x: x,
                y: y,
                vx: Math.cos(angle) * speed * (this.canvas.height / this.canvas.width), // Correct aspect ratio for velocity
                vy: Math.sin(angle) * speed,
                size: Math.random() * 30 + 10,
                color: color,
                alpha: 1.0, // Start visible
                life: 1.0
            });
        }
    }

    renderParticles() {
        const gl = this.gl;
        const ext = gl.getExtension('ANGLE_instanced_arrays');
        if (!this.isWebGL2 && !ext) return;

        gl.useProgram(this.particleProgram);
        gl.uniform2f(this.particleUniforms.resolution, this.canvas.width, this.canvas.height);

        // Update buffer
        let count = 0;
        const data = this.particleData;
        for (let i = 0; i < this.particles.length; i++) {
            const p = this.particles[i];
            const offset = count * 7;
            data[offset] = p.x;
            data[offset + 1] = p.y;
            data[offset + 2] = p.size;
            data[offset + 3] = p.color[0];
            data[offset + 4] = p.color[1];
            data[offset + 5] = p.color[2];
            data[offset + 6] = p.alpha;
            count++;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.data);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, count * 7));

        // Bind Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.position);
        gl.enableVertexAttribArray(this.particleAttributes.position);
        gl.vertexAttribPointer(this.particleAttributes.position, 2, gl.FLOAT, false, 0, 0);

        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.position, 0);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.position, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.data);

        // Center
        gl.enableVertexAttribArray(this.particleAttributes.center);
        gl.vertexAttribPointer(this.particleAttributes.center, 2, gl.FLOAT, false, 28, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.center, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.center, 1);

        // Size
        gl.enableVertexAttribArray(this.particleAttributes.size);
        gl.vertexAttribPointer(this.particleAttributes.size, 1, gl.FLOAT, false, 28, 8);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.size, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.size, 1);

        // Color
        gl.enableVertexAttribArray(this.particleAttributes.color);
        gl.vertexAttribPointer(this.particleAttributes.color, 3, gl.FLOAT, false, 28, 12);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.color, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.color, 1);

        // Alpha
        gl.enableVertexAttribArray(this.particleAttributes.alpha);
        gl.vertexAttribPointer(this.particleAttributes.alpha, 1, gl.FLOAT, false, 28, 24);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.particleAttributes.alpha, 1);
        else ext.vertexAttribDivisorANGLE(this.particleAttributes.alpha, 1);

        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
        } else {
            ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, count);
        }
    }
}
