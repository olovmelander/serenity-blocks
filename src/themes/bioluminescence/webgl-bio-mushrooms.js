
/**
 * WebGL Bio Mushrooms - Instanced rendering for glowing mushrooms
 */
export default class WebGLBioMushrooms {
    constructor(gl) {
        this.gl = gl;
        this.program = null;
        this.startTime = Date.now();
        this.mushroomCount = 0;

        // Detect WebGL 2
        this.isWebGL2 = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
    }

    init() {
        const gl = this.gl;
        const isWebGL2 = this.isWebGL2;

        // Extensions for WebGL 1
        if (!isWebGL2) {
            this.ext = gl.getExtension('ANGLE_instanced_arrays');
            if (!this.ext) {
                return false;
            }
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Vertex Shader
        const vsSource = isWebGL2 ? `#version 300 es
            in vec2 aPosition;
            in vec3 aInstanceOffset; // x, y, z
            in float aInstanceScale;
            in float aInstancePhase;
            in vec3 aInstanceColor;
            in float aInstanceType; // 0: Dome, 1: Flat, 2: Tall, 3: Bell

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            out vec3 vColor;
            out vec2 vUv;
            out float vType;
            out float vPhase;
            out float vPulse;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                // Organic Breathing (Non-uniform scale)
                float t = uTime * 2.0 + aInstancePhase;
                float breath = 0.5 + 0.5 * sin(t);
                
                // Cap expands more than stem
                float yFactor = smoothstep(-0.5, 0.5, aPosition.y / 25.0);
                pos.x *= 1.0 + breath * 0.15 * yFactor; 
                pos.y *= 1.0 + breath * 0.05;
                
                // Sway animation
                float swayT = uTime * 1.5 + aInstancePhase;
                float sway = sin(swayT) * (0.05 + uWindStrength * 0.2) * (pos.y + 20.0); 
                
                pos.x += sway;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.02 + 0.5; // Map -25..25 to 0..1
                vType = aInstanceType;
                vPhase = aInstancePhase;
                vPulse = breath;
            }
        ` : `
            attribute vec2 aPosition;
            attribute vec3 aInstanceOffset;
            attribute float aInstanceScale;
            attribute float aInstancePhase;
            attribute vec3 aInstanceColor;
            attribute float aInstanceType;

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            varying vec3 vColor;
            varying vec2 vUv;
            varying float vType;
            varying float vPhase;
            varying float vPulse;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                float t = uTime * 2.0 + aInstancePhase;
                float breath = 0.5 + 0.5 * sin(t);
                
                float yFactor = smoothstep(-0.5, 0.5, aPosition.y / 25.0);
                pos.x *= 1.0 + breath * 0.15 * yFactor; 
                pos.y *= 1.0 + breath * 0.05;
                
                float swayT = uTime * 1.5 + aInstancePhase;
                float sway = sin(swayT) * (0.05 + uWindStrength * 0.2) * (pos.y + 20.0);
                
                pos.x += sway;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.02 + 0.5;
                vType = aInstanceType;
                vPhase = aInstancePhase;
                vPulse = breath;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec3 vColor;
            in vec2 vUv;
            in float vType;
            in float vPhase;
            in float vPulse;
            
            uniform float uTime;
            
            out vec4 outColor;

            float hash(vec2 p) {
                vec3 p3  = fract(vec3(p.xyx) * .1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }
            
            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0; // -1 to 1
                float dist = length(uv);
                
                float alpha = 0.0;
                vec3 color = vColor;
                
                // Common Rim Light (Fresnel)
                float rim = smoothstep(0.6, 1.0, dist);
                
                if (vType < 0.5) { 
                    // Type 0: Spotted Dome (Amanita style but alien)
                    float cap = smoothstep(0.8, 0.75, length(uv * vec2(1.0, 0.8) + vec2(0.0, 0.2)));
                    if (uv.y < -0.2) cap = 0.0;
                    
                    float stem = smoothstep(0.15, 0.1, abs(uv.x));
                    if (uv.y > -0.2) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    // Detailed Spots
                    float spots = 0.0;
                    if (cap > 0.5) {
                        vec2 spotUV = uv * 4.0;
                        float n = noise(spotUV);
                        spots = smoothstep(0.6, 0.7, n);
                    }
                    
                    alpha = max(cap, stem);
                    
                    if (stem > 0.5) color = vColor * 0.3;
                    if (cap > 0.5) {
                        color = vColor;
                        // Gradient
                        color += vec3(0.3) * (uv.y + 0.5);
                        // Spots glow
                        if (spots > 0.5) color = mix(color, vec3(1.0), 0.8 * vPulse);
                        // Subsurface scattering feel
                        color += vec3(0.5, 0.2, 0.5) * rim * vPulse;
                    }
                    
                } else if (vType < 1.5) {
                    // Type 1: Flat Cap with Energy Rings
                    float cap = smoothstep(0.9, 0.85, length(uv * vec2(1.0, 0.4) + vec2(0.0, 0.1)));
                    if (uv.y < -0.1) cap = 0.0;
                    
                    float stem = smoothstep(0.1, 0.08, abs(uv.x));
                    if (uv.y > -0.1) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    // Energy Rings
                    float ringDist = length(uv * vec2(1.0, 0.4) + vec2(0.0, 0.1));
                    float rings = sin(ringDist * 20.0 - uTime * 2.0);
                    
                    alpha = max(cap, stem);
                    
                    if (stem > 0.5) color = vColor * 0.3;
                    if (cap > 0.5) {
                        color = vColor * 0.5;
                        color += vec3(0.5, 1.0, 1.0) * smoothstep(0.8, 1.0, rings) * vPulse;
                        color += vec3(0.2, 0.8, 1.0) * rim;
                    }
                    
                } else if (vType < 2.5) {
                    // Type 2: Fiber Optic Tall
                    float stem = smoothstep(0.08, 0.05, abs(uv.x + sin(uv.y * 5.0)*0.05));
                    if (uv.y < -0.9) stem = 0.0;
                    
                    float cap = smoothstep(0.2, 0.15, length(uv - vec2(0.0, 0.6)));
                    
                    alpha = max(cap, stem);
                    color = vColor;
                    
                    // Fiber optic glow traveling up
                    float fiberPulse = sin(uv.y * 10.0 - uTime * 5.0);
                    if (stem > 0.5) color += vec3(1.0) * smoothstep(0.9, 1.0, fiberPulse) * 0.5;
                    
                    if (cap > 0.5) color = mix(vColor, vec3(1.0), vPulse); // Bright tip
                    
                } else {
                    // Type 3: Jellyfish Bell (Translucent)
                    float bell = smoothstep(0.6, 0.55, length(uv * vec2(0.8, 1.0) + vec2(0.0, 0.1)));
                    if (uv.y < -0.3) bell = 0.0;
                    if (uv.y < -0.2 && uv.y > -0.4) {
                        bell *= smoothstep(0.0, 0.1, cos(uv.x * 15.0) * 0.1 + 0.1 + (uv.y + 0.3));
                    }
                    
                    float stem = smoothstep(0.1, 0.05, abs(uv.x));
                    if (uv.y > -0.3) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    // Internal Organs
                    float organs = smoothstep(0.2, 0.1, length(uv * vec2(1.0, 1.5) - vec2(0.0, 0.1)));
                    
                    alpha = max(bell, stem);
                    if (stem > 0.5) color = vColor * 0.3;
                    if (bell > 0.5) {
                        color = vColor * 0.4; // Translucent base
                        color += vec3(1.0, 0.5, 0.8) * organs * vPulse; // Glowing organs
                        color += vec3(0.0, 0.5, 0.5) * rim * vPulse;
                    }
                }

                if (alpha < 0.1) discard;
                
                // Final color adjustments
                color *= 1.5; // Brighten everything
                
                outColor = vec4(color, alpha);
            }
        ` : `
            precision highp float;
            varying vec3 vColor;
            varying vec2 vUv;
            varying float vType;
            varying float vPhase;
            varying float vPulse;
            
            uniform float uTime;

            float hash(vec2 p) {
                vec3 p3  = fract(vec3(p.xyx) * .1031);
                p3 += dot(p3, p3.yzx + 33.33);
                return fract((p3.x + p3.y) * p3.z);
            }
            
            float noise(vec2 st) {
                vec2 i = floor(st);
                vec2 f = fract(st);
                float a = hash(i);
                float b = hash(i + vec2(1.0, 0.0));
                float c = hash(i + vec2(0.0, 1.0));
                float d = hash(i + vec2(1.0, 1.0));
                vec2 u = f * f * (3.0 - 2.0 * f);
                return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                
                float alpha = 0.0;
                vec3 color = vColor;
                float rim = smoothstep(0.6, 1.0, dist);
                
                if (vType < 0.5) { 
                    float cap = smoothstep(0.8, 0.75, length(uv * vec2(1.0, 0.8) + vec2(0.0, 0.2)));
                    if (uv.y < -0.2) cap = 0.0;
                    
                    float stem = smoothstep(0.15, 0.1, abs(uv.x));
                    if (uv.y > -0.2) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    float spots = 0.0;
                    if (cap > 0.5) {
                        vec2 spotUV = uv * 4.0;
                        float n = noise(spotUV);
                        spots = smoothstep(0.6, 0.7, n);
                    }
                    
                    alpha = max(cap, stem);
                    
                    if (stem > 0.5) color = vColor * 0.3;
                    if (cap > 0.5) {
                        color = vColor;
                        color += vec3(0.3) * (uv.y + 0.5);
                        if (spots > 0.5) color = mix(color, vec3(1.0), 0.8 * vPulse);
                        color += vec3(0.5, 0.2, 0.5) * rim * vPulse;
                    }
                    
                } else if (vType < 1.5) {
                    float cap = smoothstep(0.9, 0.85, length(uv * vec2(1.0, 0.4) + vec2(0.0, 0.1)));
                    if (uv.y < -0.1) cap = 0.0;
                    
                    float stem = smoothstep(0.1, 0.08, abs(uv.x));
                    if (uv.y > -0.1) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    float ringDist = length(uv * vec2(1.0, 0.4) + vec2(0.0, 0.1));
                    float rings = sin(ringDist * 20.0 - uTime * 2.0);
                    
                    alpha = max(cap, stem);
                    
                    if (stem > 0.5) color = vColor * 0.3;
                    if (cap > 0.5) {
                        color = vColor * 0.5;
                        color += vec3(0.5, 1.0, 1.0) * smoothstep(0.8, 1.0, rings) * vPulse;
                        color += vec3(0.2, 0.8, 1.0) * rim;
                    }
                    
                } else if (vType < 2.5) {
                    float stem = smoothstep(0.08, 0.05, abs(uv.x + sin(uv.y * 5.0)*0.05));
                    if (uv.y < -0.9) stem = 0.0;
                    
                    float cap = smoothstep(0.2, 0.15, length(uv - vec2(0.0, 0.6)));
                    
                    alpha = max(cap, stem);
                    color = vColor;
                    
                    float fiberPulse = sin(uv.y * 10.0 - uTime * 5.0);
                    if (stem > 0.5) color += vec3(1.0) * smoothstep(0.9, 1.0, fiberPulse) * 0.5;
                    
                    if (cap > 0.5) color = mix(vColor, vec3(1.0), vPulse);
                    
                } else {
                    float bell = smoothstep(0.6, 0.55, length(uv * vec2(0.8, 1.0) + vec2(0.0, 0.1)));
                    if (uv.y < -0.3) bell = 0.0;
                    if (uv.y < -0.2 && uv.y > -0.4) {
                        bell *= smoothstep(0.0, 0.1, cos(uv.x * 15.0) * 0.1 + 0.1 + (uv.y + 0.3));
                    }
                    
                    float stem = smoothstep(0.1, 0.05, abs(uv.x));
                    if (uv.y > -0.3) stem = 0.0;
                    if (uv.y < -0.9) stem = 0.0;
                    
                    float organs = smoothstep(0.2, 0.1, length(uv * vec2(1.0, 1.5) - vec2(0.0, 0.1)));
                    
                    alpha = max(bell, stem);
                    if (stem > 0.5) color = vColor * 0.3;
                    if (bell > 0.5) {
                        color = vColor * 0.4;
                        color += vec3(1.0, 0.5, 0.8) * organs * vPulse;
                        color += vec3(0.0, 0.5, 0.5) * rim * vPulse;
                    }
                }

                if (alpha < 0.1) discard;
                color *= 1.5;
                gl_FragColor = vec4(color, alpha);
            }
        `;

        const program = this.createProgram(gl, vsSource, fsSource);
        if (!program) return false;
        this.program = program;

        // Attributes
        this.attribs = {
            position: gl.getAttribLocation(program, 'aPosition'),
            offset: gl.getAttribLocation(program, 'aInstanceOffset'),
            scale: gl.getAttribLocation(program, 'aInstanceScale'),
            phase: gl.getAttribLocation(program, 'aInstancePhase'),
            color: gl.getAttribLocation(program, 'aInstanceColor'),
            type: gl.getAttribLocation(program, 'aInstanceType'),
        };

        // Uniforms
        this.uniforms = {
            time: gl.getUniformLocation(program, 'uTime'),
            resolution: gl.getUniformLocation(program, 'uResolution'),
            windStrength: gl.getUniformLocation(program, 'uWindStrength'),
        };

        // Geometry (Quad)
        const size = 30; // Bigger than flowers
        const vertices = new Float32Array([
            -size, -size,
            size, -size,
            -size, size,
            size, size
        ]);

        this.buffers = {};
        this.buffers.position = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        return true;
    }

    createProgram(gl, vsSource, fsSource) {
        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return null;

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return null;

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        return prog;
    }

    generateMushrooms(count, width, height) {
        const gl = this.gl;
        this.mushroomCount = count;

        const offsets = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const types = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Position
            offsets[i * 3] = Math.random() * width;
            // Strictly at bottom to match grass
            offsets[i * 3 + 1] = Math.random() * 40; // Bottom 40px
            offsets[i * 3 + 2] = 0;

            // Scale
            scales[i] = 0.8 + Math.random() * 0.8;

            // Phase
            phases[i] = Math.random() * Math.PI * 2;

            // Type (0 to 3)
            const type = Math.floor(Math.random() * 4);
            types[i] = type;

            // Color
            if (type === 0) { // Dome - Red/Purple
                colors[i * 3] = 0.8 + Math.random() * 0.2;
                colors[i * 3 + 1] = 0.1;
                colors[i * 3 + 2] = 0.4 + Math.random() * 0.4;
            } else if (type === 1) { // Flat - Cyan/Blue
                colors[i * 3] = 0.0;
                colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
                colors[i * 3 + 2] = 1.0;
            } else if (type === 2) { // Tall - White/Yellow
                colors[i * 3] = 1.0;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 0.8;
            } else { // Bell - Green/Teal
                colors[i * 3] = 0.2;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 0.6;
            }
        }

        // Create Instance Buffers
        this.buffers.offset = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.offset);
        gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);

        this.buffers.scale = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.bufferData(gl.ARRAY_BUFFER, scales, gl.STATIC_DRAW);

        this.buffers.phase = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.bufferData(gl.ARRAY_BUFFER, phases, gl.STATIC_DRAW);

        this.buffers.color = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

        this.buffers.type = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.bufferData(gl.ARRAY_BUFFER, types, gl.STATIC_DRAW);
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    render(time, width, height, windStrength = 0.0) {
        if (!this.gl || !this.program || this.mushroomCount === 0) return;
        const gl = this.gl;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, width, height);
        gl.uniform1f(this.uniforms.windStrength, windStrength);

        // Bind Geometry
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        // Bind Instances
        // Offset
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.offset);
        gl.enableVertexAttribArray(this.attribs.offset);
        gl.vertexAttribPointer(this.attribs.offset, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.offset, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.offset, 1);

        // Scale
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.enableVertexAttribArray(this.attribs.scale);
        gl.vertexAttribPointer(this.attribs.scale, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.scale, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 1);

        // Phase
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.enableVertexAttribArray(this.attribs.phase);
        gl.vertexAttribPointer(this.attribs.phase, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.phase, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 1);

        // Color
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.color, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.color, 1);

        // Type
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.enableVertexAttribArray(this.attribs.type);
        gl.vertexAttribPointer(this.attribs.type, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.type, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.type, 1);

        // Draw
        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.mushroomCount);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.mushroomCount);
        }

        // Reset divisors
        if (this.isWebGL2) {
            gl.vertexAttribDivisor(this.attribs.offset, 0);
            gl.vertexAttribDivisor(this.attribs.scale, 0);
            gl.vertexAttribDivisor(this.attribs.phase, 0);
            gl.vertexAttribDivisor(this.attribs.color, 0);
            gl.vertexAttribDivisor(this.attribs.type, 0);
        } else {
            this.ext.vertexAttribDivisorANGLE(this.attribs.offset, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.color, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.type, 0);
        }
    }
}
