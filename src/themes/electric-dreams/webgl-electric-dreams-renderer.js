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

        // Blob Data (Optimization: Calculate on CPU)
        this.blobData = new Float32Array(16 * 3); // 16 blobs * 3 coords (x, y, z)
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

    initBackgroundShaders() {
        const { gl } = this;
        const { isWebGL2 } = this;

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
            uniform float uDeform;
            uniform vec3 uBlobPositions[16]; 
            uniform float uEnergy; // Combo energy for glow
            
            // Palette
            // Palette - Fluent Liquid Colors
            const vec3 COLORS[5] = vec3[](
                vec3(0.1, 1.0, 0.5), // Fluid Green
                vec3(0.0, 0.6, 1.0), // Electric Blue
                vec3(0.9, 0.1, 1.0), // Neon Magenta
                vec3(1.0, 0.3, 0.2), // Hot Red
                vec3(1.0, 0.7, 0.0)  // Amber
            );

            // Smooth minimum for blending
            float smin(float a, float b, float k) {
                float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
                return mix(b, a, h) - k * h * (1.0 - h);
            }

            // Scene mapping
            vec4 map(vec3 p) {
                float d = 100.0;
                vec3 colorAcc = vec3(0.0);
                float totalWeight = 0.0;
                
                // Domain warping
                p.x += sin(p.y * 2.0 + uTime * 0.5) * uDeform * 0.1;
                
                for(int i = 0; i < 16; i++) {
                    vec3 pos = uBlobPositions[i];
                    float r = 0.6 + sin(float(i) * 100.0) * 0.2; 
                    
                    float dist = length(p - pos) - r;
                    // Smooth blend - More "gloop"
                    d = smin(d, dist, 1.1);
                    
                    // Color blending weight - Broader spread for fluent gradients
                    float weight = 1.0 / (0.5 + dist * dist * 5.0);
                    int colorIdx = i % 5;
                    colorAcc += COLORS[colorIdx] * weight;
                    totalWeight += weight;
                }
                
                vec3 finalColor = totalWeight > 0.0 ? colorAcc / totalWeight : vec3(1.0);
                return vec4(finalColor, d);
            }

            // Calculate normal
            vec3 calcNormal(vec3 p) {
                const float h = 0.01; // Lower precision for normal is fine
                const vec2 k = vec2(1, -1);
                return normalize(k.xyy * map(p + k.xyy * h).w + 
                                 k.yyx * map(p + k.yyx * h).w + 
                                 k.yxy * map(p + k.yxy * h).w + 
                                 k.xxx * map(p + k.xxx * h).w);
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                uv.x *= uResolution.x / uResolution.y;
                
                vec3 ro = vec3(0.0, 0.0, 5.0);
                vec3 rd = normalize(vec3(uv, -1.5));
                // Raymarching
                float t = 0.0;
                // Subtle gradient background
                vec3 bgColor = mix(vec3(0.05, 0.0, 0.1), vec3(0.0, 0.05, 0.15), uv.y * 0.5 + 0.5);
                vec3 col = bgColor;              
                // Optimization: Reduced steps and increased threshold
                for(int i = 0; i < 32; i++) {
                    vec3 p = ro + rd * t;
                    vec4 res = map(p);
                    float d = res.w;
                    
                    if(d < 0.005) { // Looser threshold
                        vec3 n = calcNormal(p);
                        vec3 lightPos = vec3(2.0, 5.0, 5.0);
                        vec3 l = normalize(lightPos - p);
                        
                        float diff = max(dot(n, l), 0.0);
                        float amb = 0.2;
                        float spec = pow(max(dot(reflect(-l, n), -rd), 0.0), 32.0);
                        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
                        
                        col = res.rgb * (diff + amb) + vec3(1.0) * spec * 0.5 + vec3(0.5, 0.8, 1.0) * fresnel;
                        break;
                    }
                    
                    t += d;
                    if(t > 20.0) break;
                }
                
                float vig = 1.0 - length(vUv - 0.5) * 0.5;
                col *= vig;
                
                // Energy Glow (Combo Effect)
                col += vec3(uEnergy * 0.2) * vec3(0.8, 0.9, 1.0); // Blue-ish white glow
                col = mix(col, col * 1.2, uEnergy); // Contrast boost

                outColor = vec4(col, 1.0);
            }
        ` : `#version 100
            precision highp float;
            // Fallback for WebGL 1 (simplified or same if supported)
            // ... (keeping existing WebGL 1 shader or providing a simplified version)
            // For now, we'll just output a basic color to avoid errors if WebGL 2 fails
            void main() {
                gl_FragColor = vec4(0.2, 0.0, 0.4, 1.0);
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
            blobPositions: gl.getUniformLocation(this.bgProgram, 'uBlobPositions'),
            energy: gl.getUniformLocation(this.bgProgram, 'uEnergy'),
        };

        return true;
    }

    initParticleShaders() {
        const { gl } = this;
        const { isWebGL2 } = this;

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
        const { gl } = this;

        // Quad Buffer
        this.bgBuffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bgBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1, 1, 1,
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

    render(time, deform = 0.0, comboIntensity = 0.0) {
        this.currentDeform = deform;
        const { gl } = this;
        if (!gl) return;

        // 1. Render Background
        gl.useProgram(this.bgProgram);
        gl.uniform1f(this.bgUniforms.time, time);
        gl.uniform2f(this.bgUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.bgUniforms.deform, this.currentDeform || 0.0);
        gl.uniform1f(this.bgUniforms.energy, comboIntensity);

        // Update Blob Positions on CPU
        for (let i = 0; i < 16; i++) {
            const fi = i;
            // Speed up with combo
            const timeScale = time * (0.02 + comboIntensity * 0.03);

            // Organic movement using sines
            const nx = Math.sin(timeScale * 0.5 + fi * 2.0) + Math.sin(timeScale * 0.3 + fi * 5.0) * 0.5;
            const ny = Math.cos(timeScale * 0.4 + fi * 1.5) + Math.sin(timeScale * 0.2 + fi * 3.0) * 0.5;

            let x = nx * 3.0;
            let y = ny * 2.0 + Math.sin(time * 0.01 + fi) * 1.5;

            // Magnetic Attraction to Center
            x *= (1.0 - comboIntensity * 0.6); // Pull in X
            y *= (1.0 - comboIntensity * 0.4); // Pull in Y

            const z = Math.sin(fi * 13.0 + time * 0.05) * 2.0;

            this.blobData[i * 3] = x;
            this.blobData[i * 3 + 1] = y;
            this.blobData[i * 3 + 2] = z;
        }

        if (this.bgUniforms.blobPositions) {
            gl.uniform3fv(this.bgUniforms.blobPositions, this.blobData);
        }

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
            color,
            alpha: 0.0,
            life: 1.0,
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
                x,
                y,
                vx: Math.cos(angle) * speed * (this.canvas.height / this.canvas.width), // Correct aspect ratio for velocity
                vy: Math.sin(angle) * speed,
                size: Math.random() * 30 + 10,
                color,
                alpha: 1.0, // Start visible
                life: 1.0,
            });
        }
    }

    renderParticles() {
        const { gl } = this;
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
