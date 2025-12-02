
/**
 * WebGL Meadow Creatures - Instanced rendering for butterflies, bees, and fireflies
 */
export default class WebGLMeadowCreatures {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
        this.creatureCount = 0;
        this.creatures = []; // Store state for CPU updates (position)
    }

    init() {
        // Try WebGL 2 first
        let gl = this.canvas.getContext('webgl2', { alpha: true });
        let isWebGL2 = !!gl;

        if (!gl) {
            gl = this.canvas.getContext('webgl', { alpha: true });
        }

        if (!gl) return false;
        this.gl = gl;
        this.isWebGL2 = isWebGL2;

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
            in vec3 aInstancePosition; // x, y, z
            in float aInstanceScale;
            in float aInstancePhase;
            in vec3 aInstanceColor;
            in float aInstanceType; // 0: Butterfly, 1: Bee, 2: Firefly

            uniform float uTime;
            uniform vec2 uResolution;

            out vec3 vColor;
            out vec2 vUv;
            out float vType;
            out float vPhase;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                // Wing flap animation
                float flapSpeed = (aInstanceType == 1.0) ? 30.0 : 8.0; // Bees flap faster
                float flap = sin(uTime * flapSpeed + aInstancePhase);
                
                // Scale X to simulate flapping
                if (aInstanceType < 1.5) { // Butterfly or Bee
                    pos.x *= abs(flap); // Flap from 0 to 1
                }
                
                vec2 worldPos = pos + aInstancePosition.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.05 + 0.5; // Map -10..10 to 0..1
                vType = aInstanceType;
                vPhase = aInstancePhase;
            }
        ` : `
            attribute vec2 aPosition;
            attribute vec3 aInstancePosition;
            attribute float aInstanceScale;
            attribute float aInstancePhase;
            attribute vec3 aInstanceColor;
            attribute float aInstanceType;

            uniform float uTime;
            uniform vec2 uResolution;

            varying vec3 vColor;
            varying vec2 vUv;
            varying float vType;
            varying float vPhase;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                float flapSpeed = (aInstanceType == 1.0) ? 30.0 : 8.0;
                float flap = sin(uTime * flapSpeed + aInstancePhase);
                
                if (aInstanceType < 1.5) {
                    pos.x *= abs(flap);
                }
                
                vec2 worldPos = pos + aInstancePosition.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * 0.05 + 0.5;
                vType = aInstanceType;
                vPhase = aInstancePhase;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec3 vColor;
            in vec2 vUv;
            in float vType;
            in float vPhase;
            
            uniform float uTime;
            out vec4 outColor;

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                
                float alpha = 0.0;
                vec3 color = vColor;
                
                if (vType < 0.5) { 
                    // Butterfly (Type 0)
                    vec2 buv = uv;
                    buv.x = abs(buv.x); // Mirror x
                    
                    // Forewing
                    float forewing = smoothstep(0.0, -0.1, length(buv - vec2(0.4, 0.3)) - 0.6);
                    // Hindwing
                    float hindwing = smoothstep(0.0, -0.1, length(buv - vec2(0.2, -0.4)) - 0.5);
                    
                    float wingShape = max(forewing, hindwing);
                    
                    // Pattern (spots)
                    float spots = smoothstep(0.1, 0.05, length(buv - vec2(0.6, 0.5)));
                    spots += smoothstep(0.1, 0.05, length(buv - vec2(0.3, -0.6)));
                    
                    // Veins/Texture
                    float veins = sin(buv.x * 20.0 + buv.y * 10.0);
                    
                    color = mix(color, vec3(0.1), veins * 0.1); // Subtle veins
                    color = mix(color, vec3(1.0), spots); // White spots
                    
                    // Body
                    float body = smoothstep(0.1, 0.05, abs(uv.x)) * smoothstep(0.8, 0.7, abs(uv.y));
                    color = mix(color, vec3(0.1), body);
                    
                    alpha = max(wingShape, body);
                } else if (vType < 1.5) {
                    // Bee (Type 1)
                    // Body
                    float bodyShape = smoothstep(0.6, 0.5, length(uv * vec2(1.0, 1.5)));
                    
                    // Stripes
                    float stripes = sin(uv.x * 25.0 + uv.y * 5.0);
                    vec3 bodyColor = mix(vec3(1.0, 0.8, 0.0), vec3(0.1), step(0.5, stripes));
                    
                    // Wings
                    vec2 wuv = uv;
                    wuv.x = abs(wuv.x);
                    // Flap wings in shader for blur effect
                    float wingFlap = sin(uTime * 50.0 + vPhase);
                    vec2 wingPos = wuv - vec2(0.2, 0.3);
                    wingPos.y *= 1.5; // Elongate
                    float wingShape = smoothstep(0.4, 0.3, length(wingPos));
                    
                    // Combine
                    if (bodyShape > 0.1) {
                        color = bodyColor;
                        alpha = bodyShape;
                    } else {
                        color = vec3(0.9, 0.95, 1.0); // Whiteish wings
                        alpha = wingShape * 0.6; // Semi-transparent
                    }
                } else {
                    // Firefly (Type 2)
                    // Glow
                    float glow = exp(-dist * 3.0);
                    // Pulse
                    float pulse = sin(uTime * 3.0 + vPhase) * 0.5 + 0.5;
                    alpha = glow * pulse;
                    color = vec3(0.8, 1.0, 0.2); // Green-Yellow
                }

                if (alpha < 0.05) discard;
                
                outColor = vec4(color, alpha);
            }
        ` : `
            precision highp float;
            varying vec3 vColor;
            varying vec2 vUv;
            varying float vType;
            varying float vPhase;
            
            uniform float uTime;

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                float dist = length(uv);
                
                float alpha = 0.0;
                vec3 color = vColor;
                
                if (vType < 0.5) { 
                    vec2 buv = uv;
                    buv.x = abs(buv.x);
                    
                    float forewing = smoothstep(0.0, -0.1, length(buv - vec2(0.4, 0.3)) - 0.6);
                    float hindwing = smoothstep(0.0, -0.1, length(buv - vec2(0.2, -0.4)) - 0.5);
                    float wingShape = max(forewing, hindwing);
                    
                    float spots = smoothstep(0.1, 0.05, length(buv - vec2(0.6, 0.5)));
                    spots += smoothstep(0.1, 0.05, length(buv - vec2(0.3, -0.6)));
                    
                    float veins = sin(buv.x * 20.0 + buv.y * 10.0);
                    color = mix(color, vec3(0.1), veins * 0.1);
                    color = mix(color, vec3(1.0), spots);
                    
                    float body = smoothstep(0.1, 0.05, abs(uv.x)) * smoothstep(0.8, 0.7, abs(uv.y));
                    color = mix(color, vec3(0.1), body);
                    
                    alpha = max(wingShape, body);
                } else if (vType < 1.5) {
                    float bodyShape = smoothstep(0.6, 0.5, length(uv * vec2(1.0, 1.5)));
                    float stripes = sin(uv.x * 25.0 + uv.y * 5.0);
                    vec3 bodyColor = mix(vec3(1.0, 0.8, 0.0), vec3(0.1), step(0.5, stripes));
                    
                    vec2 wuv = uv;
                    wuv.x = abs(wuv.x);
                    vec2 wingPos = wuv - vec2(0.2, 0.3);
                    wingPos.y *= 1.5;
                    float wingShape = smoothstep(0.4, 0.3, length(wingPos));
                    
                    if (bodyShape > 0.1) {
                        color = bodyColor;
                        alpha = bodyShape;
                    } else {
                        color = vec3(0.9, 0.95, 1.0);
                        alpha = wingShape * 0.6;
                    }
                } else {
                    float glow = exp(-dist * 3.0);
                    float pulse = sin(uTime * 3.0 + vPhase) * 0.5 + 0.5;
                    alpha = glow * pulse;
                    color = vec3(0.8, 1.0, 0.2);
                }

                if (alpha < 0.05) discard;
                gl_FragColor = vec4(color, alpha);
            }
        `;

        const program = this.createProgram(gl, vsSource, fsSource);
        if (!program) return false;
        this.program = program;

        // Attributes
        this.attribs = {
            position: gl.getAttribLocation(program, 'aPosition'),
            instancePosition: gl.getAttribLocation(program, 'aInstancePosition'),
            scale: gl.getAttribLocation(program, 'aInstanceScale'),
            phase: gl.getAttribLocation(program, 'aInstancePhase'),
            color: gl.getAttribLocation(program, 'aInstanceColor'),
            type: gl.getAttribLocation(program, 'aInstanceType'),
        };

        // Uniforms
        this.uniforms = {
            time: gl.getUniformLocation(program, 'uTime'),
            resolution: gl.getUniformLocation(program, 'uResolution'),
        };

        // Geometry (Quad)
        const size = 10;
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

        // Dynamic buffers
        this.buffers.instancePosition = gl.createBuffer();
        this.buffers.scale = gl.createBuffer();
        this.buffers.phase = gl.createBuffer();
        this.buffers.color = gl.createBuffer();
        this.buffers.type = gl.createBuffer();

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

    spawnCreatures(counts, width, height) {
        this.creatures = [];
        this.width = width;
        this.height = height;

        const { butterflyCount, beeCount, fireflyCount } = counts;

        // Butterflies
        for (let i = 0; i < butterflyCount; i++) {
            this.creatures.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 1.0, // Slower
                vy: (Math.random() - 0.5) * 1.0,
                scale: 1.0 + Math.random() * 0.5,
                phase: Math.random() * Math.PI * 2,
                color: [Math.random(), Math.random(), Math.random()],
                type: 0
            });
        }

        // Bees
        for (let i = 0; i < beeCount; i++) {
            this.creatures.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 2.0, // Slower
                vy: (Math.random() - 0.5) * 2.0,
                scale: 0.5 + Math.random() * 0.3,
                phase: Math.random() * Math.PI * 2,
                color: [1.0, 0.8, 0.0], // Yellow
                type: 1
            });
        }

        // Fireflies
        for (let i = 0; i < fireflyCount; i++) {
            this.creatures.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.5, // Very slow
                vy: (Math.random() - 0.5) * 0.5,
                scale: 0.3 + Math.random() * 0.3,
                phase: Math.random() * Math.PI * 2,
                color: [0.8, 1.0, 0.5],
                type: 2
            });
        }

        this.creatureCount = this.creatures.length;
    }

    update(dt) {
        for (const c of this.creatures) {
            c.x += c.vx;
            c.y += c.vy;

            // Bounce off walls
            if (c.x < 0 || c.x > this.width) c.vx *= -1;
            if (c.y < 0 || c.y > this.height) c.vy *= -1;

            // Random direction change
            if (Math.random() < 0.02) {
                c.vx += (Math.random() - 0.5) * 0.2;
                c.vy += (Math.random() - 0.5) * 0.2;

                // Limit speed
                const speed = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
                const maxSpeed = (c.type === 1) ? 2.0 : 1.0;
                if (speed > maxSpeed) {
                    c.vx = (c.vx / speed) * maxSpeed;
                    c.vy = (c.vy / speed) * maxSpeed;
                }
            }
        }
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
            this.width = width;
            this.height = height;
        }
    }

    render(time, dt) {
        if (!this.gl || !this.program || this.creatureCount === 0) return;

        this.update(dt);

        const gl = this.gl;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);

        // Update Buffers
        const positions = new Float32Array(this.creatureCount * 3);
        const scales = new Float32Array(this.creatureCount);
        const phases = new Float32Array(this.creatureCount);
        const colors = new Float32Array(this.creatureCount * 3);
        const types = new Float32Array(this.creatureCount);

        for (let i = 0; i < this.creatureCount; i++) {
            const c = this.creatures[i];
            positions[i * 3] = c.x;
            positions[i * 3 + 1] = c.y;
            positions[i * 3 + 2] = 0;

            scales[i] = c.scale;
            phases[i] = c.phase;

            colors[i * 3] = c.color[0];
            colors[i * 3 + 1] = c.color[1];
            colors[i * 3 + 2] = c.color[2];

            types[i] = c.type;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instancePosition);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.bufferData(gl.ARRAY_BUFFER, scales, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.bufferData(gl.ARRAY_BUFFER, phases, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.bufferData(gl.ARRAY_BUFFER, types, gl.DYNAMIC_DRAW);

        // Bind Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, 0, 0);

        // Instanced Attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instancePosition);
        gl.enableVertexAttribArray(this.attribs.instancePosition);
        gl.vertexAttribPointer(this.attribs.instancePosition, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.instancePosition, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.instancePosition, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.scale);
        gl.enableVertexAttribArray(this.attribs.scale);
        gl.vertexAttribPointer(this.attribs.scale, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.scale, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.phase);
        gl.enableVertexAttribArray(this.attribs.phase);
        gl.vertexAttribPointer(this.attribs.phase, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.phase, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 3, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.color, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.color, 1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.enableVertexAttribArray(this.attribs.type);
        gl.vertexAttribPointer(this.attribs.type, 1, gl.FLOAT, false, 0, 0);
        if (this.isWebGL2) gl.vertexAttribDivisor(this.attribs.type, 1);
        else this.ext.vertexAttribDivisorANGLE(this.attribs.type, 1);

        // Draw
        if (this.isWebGL2) {
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.creatureCount);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.creatureCount);
        }

        // Reset divisors
        if (this.isWebGL2) {
            gl.vertexAttribDivisor(this.attribs.instancePosition, 0);
            gl.vertexAttribDivisor(this.attribs.scale, 0);
            gl.vertexAttribDivisor(this.attribs.phase, 0);
            gl.vertexAttribDivisor(this.attribs.color, 0);
            gl.vertexAttribDivisor(this.attribs.type, 0);
        } else {
            this.ext.vertexAttribDivisorANGLE(this.attribs.instancePosition, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.scale, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.phase, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.color, 0);
            this.ext.vertexAttribDivisorANGLE(this.attribs.type, 0);
        }
    }
}
