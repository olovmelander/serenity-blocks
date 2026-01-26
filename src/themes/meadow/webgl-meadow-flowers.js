/**
 * WebGL Meadow Flowers - Instanced rendering for swaying flowers
 */
export default class WebGLMeadowFlowers {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.startTime = Date.now();
        this.flowerCount = 0;
    }

    init() {
        // Try WebGL 2 first
        let gl = this.canvas.getContext('webgl2', { alpha: true });
        const isWebGL2 = !!gl;

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
            in vec3 aInstanceOffset; // x, y, z
            in float aInstanceScale;
            in float aInstancePhase;
            in vec3 aInstanceColor;
            in float aInstanceType; // 0: Daisy, 1: Poppy, 2: Lavender, 3: Bluebell, 4: Tulip, 5: Dandelion

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uWindStrength;

            out vec3 vColor;
            out vec2 vUv;
            out float vType;
            out float vStem;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                // Wind animation (swaying) - Anchored at bottom
                // Map y from -size..size to 0..1 for bending factor
                float normalizedHeight = (aPosition.y / 80.0) + 0.5; // Assuming height is 80
                normalizedHeight = clamp(normalizedHeight, 0.0, 1.0);

                float t = uTime * 1.5 + aInstancePhase + aInstanceOffset.x * 0.01;
                float wind = sin(t) * (0.1 + uWindStrength) * normalizedHeight * 30.0;
                
                // Add some turbulence
                wind += sin(t * 2.5) * 5.0 * normalizedHeight;

                pos.x += wind;
                
                // Slight vertical compression when bending
                pos.y -= abs(wind) * 0.1;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * vec2(1.0/30.0, 1.0/80.0) + vec2(0.5, 0.0); // Map to 0..1
                vType = aInstanceType;
                vStem = normalizedHeight;
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
            varying float vStem;

            void main() {
                vec2 pos = aPosition * aInstanceScale;
                
                float normalizedHeight = (aPosition.y / 80.0) + 0.5;
                normalizedHeight = clamp(normalizedHeight, 0.0, 1.0);

                float t = uTime * 1.5 + aInstancePhase + aInstanceOffset.x * 0.01;
                float wind = sin(t) * (0.1 + uWindStrength) * normalizedHeight * 30.0;
                wind += sin(t * 2.5) * 5.0 * normalizedHeight;

                pos.x += wind;
                pos.y -= abs(wind) * 0.1;
                
                vec2 worldPos = pos + aInstanceOffset.xy;
                vec2 clipPos = (worldPos / uResolution) * 2.0 - 1.0;
                
                gl_Position = vec4(clipPos, 0.0, 1.0);
                
                vColor = aInstanceColor;
                vUv = aPosition * vec2(1.0/30.0, 1.0/80.0) + vec2(0.5, 0.0);
                vType = aInstanceType;
                vStem = normalizedHeight;
            }
        `;

        // Fragment Shader
        const fsSource = isWebGL2 ? `#version 300 es
            precision highp float;
            in vec3 vColor;
            in vec2 vUv;
            in float vType;
            in float vStem;
            out vec4 outColor;

            void main() {
                // UVs: x[0..1], y[0..1]
                // Flower head is mostly in top 40% (y > 0.6)
                // Stem is in bottom 60%
                
                vec2 headUv = (vUv - vec2(0.5, 0.75)) * vec2(2.0, 2.0); // Center head at 0.5, 0.75
                float dist = length(headUv);
                float angle = atan(headUv.y, headUv.x);
                
                vec4 finalColor = vec4(0.0);
                
                // --- STEM ---
                // Simple curve based on x
                float stemCurve = sin(vUv.y * 5.0) * 0.05;
                float stemWidth = 0.03 + (1.0 - vUv.y) * 0.02; // Thicker at bottom
                float stemShape = smoothstep(stemWidth, stemWidth - 0.01, abs(vUv.x - 0.5 + stemCurve));
                
                // Cut off stem above flower base
                stemShape *= smoothstep(0.75, 0.70, vUv.y);
                
                vec3 stemColor = vec3(0.1, 0.4, 0.1); // Dark green
                // Add some shading to stem
                stemColor *= 0.8 + 0.4 * smoothstep(-0.5, 0.5, (vUv.x - 0.5) / stemWidth);
                
                // Leaves (simple)
                if (vUv.y < 0.5 && vUv.y > 0.1) {
                    float leafY = (vUv.y - 0.3) * 4.0;
                    float leafX = (vUv.x - 0.5) * 4.0;
                    float leafDist = length(vec2(leafX, leafY));
                    // Two leaves sticking out
                    float leafShape = smoothstep(0.2, 0.15, abs(leafX) - leafY*leafY);
                    leafShape *= smoothstep(0.5, 0.0, abs(leafY));
                    stemShape = max(stemShape, leafShape);
                }

                finalColor = vec4(stemColor, stemShape);

                // --- FLOWER HEAD ---
                // Only draw head if we are near the top
                if (vUv.y > 0.4) {
                    float alpha = 0.0;
                    vec3 color = vColor;
                    
                    if (vType < 0.5) { 
                        // Daisy (Type 0)
                        float petals = cos(angle * 12.0) * 0.2 + 0.8;
                        float shape = smoothstep(0.5, 0.45, dist / petals);
                        
                        // Center
                        float center = smoothstep(0.15, 0.12, dist);
                        float centerDetail = sin(headUv.x * 50.0) * sin(headUv.y * 50.0) * 0.1;
                        
                        alpha = shape;
                        vec3 petalColor = mix(vec3(0.9, 0.9, 1.0), vec3(1.0, 1.0, 1.0), dist * 2.0);
                        vec3 centerColor = vec3(1.0, 0.8, 0.1) + centerDetail;
                        
                        color = mix(petalColor, centerColor, center);
                    } else if (vType < 1.5) {
                        // Poppy (Type 1)
                        float petals = cos(angle * 4.0 + sin(dist*10.0)) * 0.1 + 0.9;
                        float shape = smoothstep(0.5, 0.45, dist / petals);
                        float center = smoothstep(0.15, 0.1, dist);
                        
                        alpha = shape;
                        vec3 petalColor = vColor * (0.8 + 0.4 * dist); // Gradient
                        color = mix(petalColor, vec3(0.1, 0.05, 0.05), center);
                    } else if (vType < 2.5) {
                        // Lavender (Type 2) - Vertical cluster
                        // Remap UV for tall flower
                        vec2 luv = (vUv - vec2(0.5, 0.7)) * vec2(3.0, 1.0);
                        float shape = smoothstep(0.3, 0.2, length(luv));
                        
                        // Individual florets
                        float dots = smoothstep(0.4, 0.6, sin(luv.y * 30.0) * sin(luv.x * 20.0));
                        
                        alpha = shape;
                        color = mix(vColor * 0.7, vColor * 1.2, dots);
                    } else if (vType < 3.5) {
                        // Bluebell (Type 3) - Drooping bell
                        // Shift center
                        vec2 buv = headUv + vec2(0.0, 0.1);
                        float width = 0.3 + 0.3 * buv.y; 
                        float shape = smoothstep(width, width - 0.05, abs(buv.x));
                        shape *= smoothstep(0.5, 0.4, abs(buv.y));
                        
                        if (buv.y < -0.2) {
                             // Scallops
                             shape *= smoothstep(0.0, 0.1, cos(buv.x * 15.0) * 0.1 + 0.1 + (buv.y + 0.4));
                        }
                        
                        alpha = shape;
                        color = mix(vColor * 0.5, vColor, buv.y + 0.5);
                    } else if (vType < 4.5) {
                        // Tulip (Type 4)
                        vec2 tuv = headUv + vec2(0.0, 0.1);
                        float cup = smoothstep(0.4, 0.35, length(tuv * vec2(1.0, 0.8) + vec2(0.0, 0.1)));
                        // Petal definition
                        float petalLine = smoothstep(0.02, 0.0, abs(tuv.x * 0.5) - 0.01 * (tuv.y + 1.0));
                        
                        alpha = cup;
                        color = mix(vColor, vColor * 0.8, petalLine * 0.3);
                        // Vertical shading
                        color *= 0.8 + 0.4 * smoothstep(-0.4, 0.4, tuv.x);
                    } else {
                        // Dandelion (Type 5)
                        float spikes = sin(angle * 40.0) * 0.1 + 0.7;
                        // Fuzzy edge
                        float shape = smoothstep(spikes, spikes - 0.2, dist);
                        // Center glow
                        float core = smoothstep(0.1, 0.0, dist);
                        
                        alpha = shape;
                        color = mix(vColor, vec3(1.0, 1.0, 0.8), core);
                    }
                    
                    // Composite head over stem
                    if (alpha > 0.1) {
                        finalColor = vec4(color, alpha);
                    }
                }

                if (finalColor.a < 0.1) discard;
                outColor = finalColor;
            }
        ` : `
            precision highp float;
            varying vec3 vColor;
            varying vec2 vUv;
            varying float vType;
            varying float vStem;

            void main() {
                vec2 headUv = (vUv - vec2(0.5, 0.75)) * vec2(2.0, 2.0);
                float dist = length(headUv);
                float angle = atan(headUv.y, headUv.x);
                
                vec4 finalColor = vec4(0.0);
                
                // --- STEM ---
                float stemCurve = sin(vUv.y * 5.0) * 0.05;
                float stemWidth = 0.03 + (1.0 - vUv.y) * 0.02;
                float stemShape = smoothstep(stemWidth, stemWidth - 0.01, abs(vUv.x - 0.5 + stemCurve));
                
                stemShape *= smoothstep(0.75, 0.70, vUv.y);
                
                vec3 stemColor = vec3(0.1, 0.4, 0.1);
                stemColor *= 0.8 + 0.4 * smoothstep(-0.5, 0.5, (vUv.x - 0.5) / stemWidth);
                
                if (vUv.y < 0.5 && vUv.y > 0.1) {
                    float leafY = (vUv.y - 0.3) * 4.0;
                    float leafX = (vUv.x - 0.5) * 4.0;
                    float leafDist = length(vec2(leafX, leafY));
                    float leafShape = smoothstep(0.2, 0.15, abs(leafX) - leafY*leafY);
                    leafShape *= smoothstep(0.5, 0.0, abs(leafY));
                    stemShape = max(stemShape, leafShape);
                }

                finalColor = vec4(stemColor, stemShape);

                // --- FLOWER HEAD ---
                if (vUv.y > 0.4) {
                    float alpha = 0.0;
                    vec3 color = vColor;
                    
                    if (vType < 0.5) { 
                        float petals = cos(angle * 12.0) * 0.2 + 0.8;
                        float shape = smoothstep(0.5, 0.45, dist / petals);
                        float center = smoothstep(0.15, 0.12, dist);
                        float centerDetail = sin(headUv.x * 50.0) * sin(headUv.y * 50.0) * 0.1;
                        alpha = shape;
                        vec3 petalColor = mix(vec3(0.9, 0.9, 1.0), vec3(1.0, 1.0, 1.0), dist * 2.0);
                        vec3 centerColor = vec3(1.0, 0.8, 0.1) + centerDetail;
                        color = mix(petalColor, centerColor, center);
                    } else if (vType < 1.5) {
                        float petals = cos(angle * 4.0 + sin(dist*10.0)) * 0.1 + 0.9;
                        float shape = smoothstep(0.5, 0.45, dist / petals);
                        float center = smoothstep(0.15, 0.1, dist);
                        alpha = shape;
                        vec3 petalColor = vColor * (0.8 + 0.4 * dist);
                        color = mix(petalColor, vec3(0.1, 0.05, 0.05), center);
                    } else if (vType < 2.5) {
                        vec2 luv = (vUv - vec2(0.5, 0.7)) * vec2(3.0, 1.0);
                        float shape = smoothstep(0.3, 0.2, length(luv));
                        float dots = smoothstep(0.4, 0.6, sin(luv.y * 30.0) * sin(luv.x * 20.0));
                        alpha = shape;
                        color = mix(vColor * 0.7, vColor * 1.2, dots);
                    } else if (vType < 3.5) {
                        vec2 buv = headUv + vec2(0.0, 0.1);
                        float width = 0.3 + 0.3 * buv.y; 
                        float shape = smoothstep(width, width - 0.05, abs(buv.x));
                        shape *= smoothstep(0.5, 0.4, abs(buv.y));
                        if (buv.y < -0.2) {
                             shape *= smoothstep(0.0, 0.1, cos(buv.x * 15.0) * 0.1 + 0.1 + (buv.y + 0.4));
                        }
                        alpha = shape;
                        color = mix(vColor * 0.5, vColor, buv.y + 0.5);
                    } else if (vType < 4.5) {
                        vec2 tuv = headUv + vec2(0.0, 0.1);
                        float cup = smoothstep(0.4, 0.35, length(tuv * vec2(1.0, 0.8) + vec2(0.0, 0.1)));
                        float petalLine = smoothstep(0.02, 0.0, abs(tuv.x * 0.5) - 0.01 * (tuv.y + 1.0));
                        alpha = cup;
                        color = mix(vColor, vColor * 0.8, petalLine * 0.3);
                        color *= 0.8 + 0.4 * smoothstep(-0.4, 0.4, tuv.x);
                    } else {
                        float spikes = sin(angle * 40.0) * 0.1 + 0.7;
                        float shape = smoothstep(spikes, spikes - 0.2, dist);
                        float core = smoothstep(0.1, 0.0, dist);
                        alpha = shape;
                        color = mix(vColor, vec3(1.0, 1.0, 0.8), core);
                    }
                    
                    if (alpha > 0.1) {
                        finalColor = vec4(color, alpha);
                    }
                }

                if (finalColor.a < 0.1) discard;
                gl_FragColor = finalColor;
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

        // Geometry (Tall Quad for flower + stem)
        // Width: 30, Height: 80
        const w = 15; // Half width
        const h = 80; // Total height
        // Anchor at bottom center (0,0) to (0, h)
        // But we want to center it horizontally
        const vertices = new Float32Array([
            -w, 0.0,
            w, 0.0,
            -w, h,
            w, h,
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

    generateFlowers(count, width, height) {
        const { gl } = this;
        this.flowerCount = count;

        const offsets = new Float32Array(count * 3);
        const scales = new Float32Array(count);
        const phases = new Float32Array(count);
        const colors = new Float32Array(count * 3);
        const types = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Position
            offsets[i * 3] = Math.random() * width;
            // Start slightly below screen (-50) up to 25% height
            offsets[i * 3 + 1] = -50 + Math.random() * (height * 0.25 + 50);
            offsets[i * 3 + 2] = 0;

            // Scale
            scales[i] = 0.5 + Math.random() * 0.5; // Smaller flowers

            // Phase
            phases[i] = Math.random() * Math.PI * 2;

            // Type (0 to 5)
            const type = Math.floor(Math.random() * 6);
            types[i] = type;

            // Color based on type
            if (type === 0) { // Daisy (White)
                colors[i * 3] = 1.0;
                colors[i * 3 + 1] = 1.0;
                colors[i * 3 + 2] = 1.0;
            } else if (type === 1) { // Poppy (Red/Orange)
                colors[i * 3] = 1.0;
                colors[i * 3 + 1] = 0.2 + Math.random() * 0.2;
                colors[i * 3 + 2] = 0.1;
            } else if (type === 2) { // Lavender (Purple)
                colors[i * 3] = 0.6;
                colors[i * 3 + 1] = 0.4;
                colors[i * 3 + 2] = 0.9;
            } else if (type === 3) { // Bluebell (Blue/Violet)
                colors[i * 3] = 0.3 + Math.random() * 0.2;
                colors[i * 3 + 1] = 0.3 + Math.random() * 0.2;
                colors[i * 3 + 2] = 0.9;
            } else if (type === 4) { // Tulip (Pink/Yellow/Red)
                const r = Math.random();
                if (r < 0.33) { // Pink
                    colors[i * 3] = 1.0;
                    colors[i * 3 + 1] = 0.4;
                    colors[i * 3 + 2] = 0.7;
                } else if (r < 0.66) { // Yellow
                    colors[i * 3] = 1.0;
                    colors[i * 3 + 1] = 0.9;
                    colors[i * 3 + 2] = 0.1;
                } else { // Red
                    colors[i * 3] = 0.9;
                    colors[i * 3 + 1] = 0.1;
                    colors[i * 3 + 2] = 0.1;
                }
            } else { // Dandelion (Yellow)
                colors[i * 3] = 1.0;
                colors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
                colors[i * 3 + 2] = 0.0;
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

    render(time, windStrength = 0.0) {
        if (!this.gl || !this.program || this.flowerCount === 0) return;
        const { gl } = this;

        gl.useProgram(this.program);

        gl.uniform1f(this.uniforms.time, time);
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
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
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.flowerCount);
        } else {
            this.ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, this.flowerCount);
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
