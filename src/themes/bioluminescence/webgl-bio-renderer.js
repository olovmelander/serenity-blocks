/**
 * WebGL Bio Renderer - GPU-accelerated particle rendering for Bioluminescence theme
 * 
 * Renders fireflies, spores, and other glowing particles using WebGL point sprites.
 * Handles thousands of particles with efficient single-draw-call rendering.
 */

export default class WebGLBioRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.buffers = {};
        this.uniforms = {};
        this.attributes = {};

        // Particle data
        this.particleCount = 0;
        this.maxParticles = 0;

        // Typed arrays for GPU upload
        this.positionData = null;      // x, y per particle
        this.sizeData = null;          // size per particle
        this.colorData = null;         // r, g, b per particle
        this.pulseData = null;         // phase, speed per particle
        this.opacityData = null;       // base opacity, boost per particle

        // Color palette as normalized RGB
        this.colorPalette = [];
    }

    /**
     * Initialize WebGL context and compile shaders
     * @returns {boolean} Success
     */
    init() {
        const gl = this.canvas.getContext('webgl', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false,
            preserveDrawingBuffer: false,
        }) || this.canvas.getContext('experimental-webgl');

        if (!gl) {
            console.warn('WebGL not supported, falling back to Canvas2D');
            return false;
        }

        this.gl = gl;

        // Enable blending for transparent particles
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow effect

        // Compile shaders
        if (!this.initShaders()) {
            return false;
        }

        // Create buffers
        this.initBuffers();

        return true;
    }

    initShaders() {
        const gl = this.gl;

        // Vertex shader
        const vertexShaderSource = `
            precision highp float;
            
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec3 aColor;
            attribute vec2 aPulse;        // x = phase, y = speed
            attribute vec2 aOpacity;      // x = base, y = boost
            
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uGlobalPulse;
            
            varying vec3 vColor;
            varying float vOpacity;
            varying float vSize;
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                // Calculate pulse (scale time to match Canvas2D frame-by-frame accumulation)
                float phase = aPulse.x + uTime * aPulse.y * 62.5;
                float pulse = sin(phase) * 0.3 + 0.7; // Pulse between 0.4 and 1.0
                
                // Calculate final opacity
                float boost = 1.0 + uGlobalPulse * 0.8; // Stronger global pulse influence
                vOpacity = min(aOpacity.x * pulse * boost + aOpacity.y, 1.0);
                vColor = aColor;
                
                // Size with slight pulse
                float sizePulse = 1.0 + sin(phase) * 0.1;
                vSize = aSize * sizePulse;
                
                // Point size (in pixels)
                gl_PointSize = vSize * 2.5;
            }
        `;

        // Fragment shader
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 vColor;
            varying float vOpacity;
            varying float vSize;
            
            void main() {
                // Distance from center of point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft circular falloff
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Add glow effect for larger particles
                float glow = 0.0;
                if (vSize > 3.0) {
                    glow = exp(-dist * 2.5) * 0.3;
                }
                
                float finalAlpha = (alpha + glow) * vOpacity;
                
                // Discard fully transparent pixels
                if (finalAlpha < 0.01) discard;
                
                gl_FragColor = vec4(vColor * finalAlpha, finalAlpha);
            }
        `;

        // Compile vertex shader
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('Vertex shader error:', gl.getShaderInfoLog(vertexShader));
            return false;
        }

        // Compile fragment shader
        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('Fragment shader error:', gl.getShaderInfoLog(fragmentShader));
            return false;
        }

        // Link program
        this.program = gl.createProgram();
        gl.attachShader(this.program, vertexShader);
        gl.attachShader(this.program, fragmentShader);
        gl.linkProgram(this.program);

        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(this.program));
            return false;
        }

        // Get attribute locations
        this.attributes = {
            position: gl.getAttribLocation(this.program, 'aPosition'),
            size: gl.getAttribLocation(this.program, 'aSize'),
            color: gl.getAttribLocation(this.program, 'aColor'),
            pulse: gl.getAttribLocation(this.program, 'aPulse'),
            opacity: gl.getAttribLocation(this.program, 'aOpacity'),
        };

        // Get uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'uResolution'),
            time: gl.getUniformLocation(this.program, 'uTime'),
            globalPulse: gl.getUniformLocation(this.program, 'uGlobalPulse'),
        };

        return true;
    }

    initBuffers() {
        const gl = this.gl;

        this.buffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
            pulse: gl.createBuffer(),
            opacity: gl.createBuffer(),
        };
    }

    /**
     * Allocate buffers for particles
     */
    allocateParticles(count) {
        this.maxParticles = count;
        this.particleCount = 0;

        // Allocate typed arrays
        this.positionData = new Float32Array(count * 2);
        this.sizeData = new Float32Array(count);
        this.colorData = new Float32Array(count * 3);
        this.pulseData = new Float32Array(count * 2);
        this.opacityData = new Float32Array(count * 2);
    }

    /**
     * Upload particle data
     */
    uploadParticles(particles) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(particles.length, this.maxParticles);
        this.particleCount = count;

        // Fill typed arrays from particle objects
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;
            const i3 = i * 3;

            // Position
            this.positionData[i2] = p.x;
            this.positionData[i2 + 1] = p.y;

            // Size
            this.sizeData[i] = p.size;

            // Color (RGB array or hex string)
            if (Array.isArray(p.colorRGB)) {
                this.colorData[i3] = p.colorRGB[0];
                this.colorData[i3 + 1] = p.colorRGB[1];
                this.colorData[i3 + 2] = p.colorRGB[2];
            } else if (typeof p.color === 'string') {
                // Simple color mapping for common bio colors
                if (p.color === 'cyan') {
                    this.colorData[i3] = 0.0; this.colorData[i3 + 1] = 1.0; this.colorData[i3 + 2] = 1.0;
                } else if (p.color === 'green') {
                    this.colorData[i3] = 0.2; this.colorData[i3 + 1] = 1.0; this.colorData[i3 + 2] = 0.4;
                } else {
                    // Default white
                    this.colorData[i3] = 1.0; this.colorData[i3 + 1] = 1.0; this.colorData[i3 + 2] = 1.0;
                }
            }

            // Pulse (phase, speed)
            this.pulseData[i2] = p.pulsePhase || 0;
            this.pulseData[i2 + 1] = p.pulseSpeed || 0;

            // Opacity (base, boost)
            this.opacityData[i2] = p.opacity || p.brightness || 1.0;
            this.opacityData[i2 + 1] = 0; // Boost
        }

        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this.positionData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, this.sizeData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, this.colorData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pulse);
        gl.bufferData(gl.ARRAY_BUFFER, this.pulseData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.opacity);
        gl.bufferData(gl.ARRAY_BUFFER, this.opacityData, gl.DYNAMIC_DRAW);
    }

    /**
     * Update particle positions (call each frame)
     */
    updatePositions(particles) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(particles.length, this.particleCount);

        for (let i = 0; i < count; i++) {
            const i2 = i * 2;
            this.positionData[i2] = particles[i].x;
            this.positionData[i2 + 1] = particles[i].y;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionData);
    }

    /**
     * Clear the canvas
     */
    clear() {
        const gl = this.gl;
        if (!gl) return;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    /**
     * Render all particles
     */
    render(time, globalPulse = 0) {
        const gl = this.gl;
        if (!gl || this.particleCount === 0) return;

        gl.useProgram(this.program);

        // Use Additive blending for glowing particles
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.globalPulse, globalPulse);

        // Bind attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.enableVertexAttribArray(this.attributes.size);
        gl.vertexAttribPointer(this.attributes.size, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attributes.color);
        gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pulse);
        gl.enableVertexAttribArray(this.attributes.pulse);
        gl.vertexAttribPointer(this.attributes.pulse, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.opacity);
        gl.enableVertexAttribArray(this.attributes.opacity);
        gl.vertexAttribPointer(this.attributes.opacity, 2, gl.FLOAT, false, 0, 0);

        // Draw
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
    }

    /**
     * Initialize texture shader program
     */
    initTextureShaders() {
        const gl = this.gl;

        const vertexShaderSource = `
            precision highp float;
            
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec4 aUV;           // x, y, width, height
            attribute float aOpacity;
            attribute float aRotation;
            attribute float aSway;        // Sway amplitude
            
            uniform vec2 uResolution;
            uniform float uTime;
            
            varying vec4 vUV;
            varying float vOpacity;
            varying float vRotation;
            varying float vSway;
            varying float vY; // For phase offset
            
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                gl_PointSize = aSize;
                
                vUV = aUV;
                vOpacity = aOpacity;
                vRotation = aRotation;
                vSway = aSway;
                vY = aPosition.y; // Use Y position for sway phase
            }
        `;

        const fragmentShaderSource = `
            precision highp float;
            
            uniform sampler2D uTexture;
            uniform float uTime;
            
            varying vec4 vUV;
            varying float vOpacity;
            varying float vRotation;
            varying float vSway;
            varying float vY;
            
            void main() {
                vec2 coord = gl_PointCoord;
                
                // Wind/Sway effect (Shear)
                // We want the bottom (y=1.0) to be fixed, and top (y=0.0) to sway
                // Note: gl_PointCoord y is 0 at top, 1 at bottom usually
                
                if (vSway > 0.0) {
                    float swayAmount = sin(uTime * 2.0 + vY * 0.01) * vSway * 0.2;
                    // Apply shear: x += sway * (1.0 - y) -> moves top more
                    // But we want bottom fixed. If y=1 is bottom, (1-y) is 0 at bottom.
                    coord.x += swayAmount * (1.0 - coord.y);
                }
                
                // Center for rotation
                vec2 centered = coord - 0.5;
                
                // Rotate
                float s = sin(-vRotation);
                float c = cos(-vRotation);
                mat2 rot = mat2(c, -s, s, c);
                centered = rot * centered;
                
                coord = centered + 0.5;
                
                // Map to atlas UV
                vec2 uv = vUV.xy + coord * vUV.zw;
                
                vec4 texColor = texture2D(uTexture, uv);
                
                // Discard if out of sprite bounds or transparent
                if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || texColor.a < 0.01) discard;
                
                gl_FragColor = texColor * vOpacity;
            }
        `;

        // Compile shaders
        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);
        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            console.error('Texture VS error:', gl.getShaderInfoLog(vertexShader));
            return false;
        }

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);
        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            console.error('Texture FS error:', gl.getShaderInfoLog(fragmentShader));
            return false;
        }

        this.textureProgram = gl.createProgram();
        gl.attachShader(this.textureProgram, vertexShader);
        gl.attachShader(this.textureProgram, fragmentShader);
        gl.linkProgram(this.textureProgram);

        if (!gl.getProgramParameter(this.textureProgram, gl.LINK_STATUS)) {
            console.error('Texture Program link error:', gl.getProgramInfoLog(this.textureProgram));
            return false;
        }

        // Locations
        this.texAttribs = {
            position: gl.getAttribLocation(this.textureProgram, 'aPosition'),
            size: gl.getAttribLocation(this.textureProgram, 'aSize'),
            uv: gl.getAttribLocation(this.textureProgram, 'aUV'),
            opacity: gl.getAttribLocation(this.textureProgram, 'aOpacity'),
            rotation: gl.getAttribLocation(this.textureProgram, 'aRotation'),
            sway: gl.getAttribLocation(this.textureProgram, 'aSway'),
        };

        this.texUniforms = {
            resolution: gl.getUniformLocation(this.textureProgram, 'uResolution'),
            time: gl.getUniformLocation(this.textureProgram, 'uTime'),
            texture: gl.getUniformLocation(this.textureProgram, 'uTexture'),
        };

        // Buffers
        this.texBuffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            uv: gl.createBuffer(),
            opacity: gl.createBuffer(),
            rotation: gl.createBuffer(),
            sway: gl.createBuffer(),
        };

        return true;
    }

    uploadTexture(image) {
        const gl = this.gl;
        if (!gl) return;

        if (!this.texture) {
            this.texture = gl.createTexture();
        }

        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }

    renderTexturedParticles(particles, time) {
        const gl = this.gl;
        if (!gl || !this.textureProgram || particles.length === 0) return;

        const count = particles.length;

        // Prepare data arrays
        // Note: For production, reuse allocated Float32Arrays instead of creating new ones
        const positions = new Float32Array(count * 2);
        const sizes = new Float32Array(count);
        const uvs = new Float32Array(count * 4);
        const opacities = new Float32Array(count);
        const rotations = new Float32Array(count);
        const sways = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;
            const i4 = i * 4;

            positions[i2] = p.x;
            positions[i2 + 1] = p.y;
            sizes[i] = p.size || p.width; // Use width/size as point size

            // UVs (x, y, w, h)
            if (p.uv) {
                uvs[i4] = p.uv.x;
                uvs[i4 + 1] = p.uv.y;
                uvs[i4 + 2] = p.uv.w;
                uvs[i4 + 3] = p.uv.h;
            }

            opacities[i] = p.opacity !== undefined ? p.opacity : 1.0;
            rotations[i] = p.rotation || 0;
            sways[i] = p.sway || 0;
        }

        gl.useProgram(this.textureProgram);

        // Use Normal blending for textured sprites (so they look solid)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.uniform2f(this.texUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.texUniforms.time, time); // Pass time for sway
        gl.uniform1i(this.texUniforms.texture, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        // Bind and upload buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.position);
        gl.vertexAttribPointer(this.texAttribs.position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.size);
        gl.vertexAttribPointer(this.texAttribs.size, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.uv);
        gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.uv);
        gl.vertexAttribPointer(this.texAttribs.uv, 4, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.opacity);
        gl.bufferData(gl.ARRAY_BUFFER, opacities, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.opacity);
        gl.vertexAttribPointer(this.texAttribs.opacity, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.rotation);
        gl.bufferData(gl.ARRAY_BUFFER, rotations, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.rotation);
        gl.vertexAttribPointer(this.texAttribs.rotation, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texBuffers.sway);
        gl.bufferData(gl.ARRAY_BUFFER, sways, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.texAttribs.sway);
        gl.vertexAttribPointer(this.texAttribs.sway, 1, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, count);

        // Restore additive blending for other particles
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    }

    destroy() {
        const gl = this.gl;
        if (!gl) return;

        Object.values(this.buffers).forEach(buffer => {
            if (buffer) gl.deleteBuffer(buffer);
        });

        if (this.texBuffers) {
            Object.values(this.texBuffers).forEach(buffer => {
                if (buffer) gl.deleteBuffer(buffer);
            });
        }

        if (this.program) gl.deleteProgram(this.program);
        if (this.textureProgram) gl.deleteProgram(this.textureProgram);
        if (this.texture) gl.deleteTexture(this.texture);

        this.gl = null;
    }
}
