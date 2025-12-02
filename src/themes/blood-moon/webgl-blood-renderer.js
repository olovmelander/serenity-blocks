/**
 * WebGL Blood Renderer - GPU-accelerated particle/star rendering for Blood Moon theme
 * 
 * Adapted from WebGL Star Renderer (Geode theme)
 * - Renders stars/particles in a single GPU draw call
 * - Handles blood-moon specific atmosphere and pulsing
 */

export default class WebGLBloodRenderer {
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
        this.twinkleData = null;       // phase, speed per particle
        this.brightnessData = null;    // base brightness, pulse boost per particle

        // Dirty flags
        this.positionsDirty = true;
        this.brightnessDirty = true;
        this.colorsDirty = true;
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow

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
            attribute vec2 aTwinkle;      // x = phase, y = speed
            attribute vec2 aBrightness;   // x = base, y = pulse boost
            
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uGlobalPulse;   // Global heartbeat pulse
            uniform vec2 uMoonPos;        // Moon position (canvas coords)
            uniform float uMoonRadius;    // Moon radius
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            varying vec2 vPos;            // Screen position
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                // Pass position to fragment shader
                vPos = aPosition;
                
                // Calculate twinkle/pulse
                float phase = aTwinkle.x + uTime * aTwinkle.y * 50.0;
                float twinkle = sin(phase) * 0.3 + 0.7;
                
                // Combine local twinkle with global heartbeat pulse
                float pulseEffect = 1.0 + uGlobalPulse * 0.3;
                
                // Final brightness
                float baseBrightness = aBrightness.x * twinkle * pulseEffect;
                float boost = aBrightness.y;
                
                vBrightness = min(baseBrightness + boost, 1.5);
                vColor = aColor;
                
                // Size pulsation
                float sizePulse = 1.0 + uGlobalPulse * 0.1;
                vSize = aSize * sizePulse;
                
                // Point size (in pixels)
                gl_PointSize = vSize * 2.5;
            }
        `;

        // Fragment shader - Soft blood glow
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            varying vec2 vPos;
            
            uniform vec2 uMoonPos;
            uniform float uMoonRadius;
            uniform vec2 uResolution;
            
            void main() {
                // Check moon occlusion
                // Note: vPos is the center of the star. We can use that for simple occlusion.
                // Or we can use gl_FragCoord for per-pixel occlusion.
                // Using vPos is faster and likely sufficient for stars.
                
                float distToMoon = distance(vPos, uMoonPos);
                if (distToMoon < uMoonRadius * 1.2) {
                    discard;
                }
                
                // Distance from center of point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft circular falloff
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Blood glow effect
                // Redder colors get more glow
                float redness = vColor.r * (1.0 - vColor.g) * (1.0 - vColor.b);
                float glow = exp(-dist * 2.5) * 0.5 * redness;
                
                float finalAlpha = (alpha + glow) * vBrightness;
                
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
            twinkle: gl.getAttribLocation(this.program, 'aTwinkle'),
            brightness: gl.getAttribLocation(this.program, 'aBrightness'),
        };

        // Get uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'uResolution'),
            time: gl.getUniformLocation(this.program, 'uTime'),
            globalPulse: gl.getUniformLocation(this.program, 'uGlobalPulse'),
            moonPos: gl.getUniformLocation(this.program, 'uMoonPos'),
            moonRadius: gl.getUniformLocation(this.program, 'uMoonRadius'),
        };

        return true;
    }

    initBuffers() {
        const gl = this.gl;

        this.buffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
            twinkle: gl.createBuffer(),
            brightness: gl.createBuffer(),
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
        this.twinkleData = new Float32Array(count * 2);
        this.brightnessData = new Float32Array(count * 2);
    }

    /**
     * Upload particle data
     */
    uploadParticles(particles) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(particles.length, this.maxParticles);
        this.particleCount = count;

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;
            const i3 = i * 3;

            // Position
            this.positionData[i2] = p.x;
            this.positionData[i2 + 1] = p.y;

            // Size
            this.sizeData[i] = p.size;

            // Color - handle 'red' vs 'white' or hex/rgb
            let r, g, b;
            if (p.color === 'red') {
                r = 1.0; g = 0.59; b = 0.59; // rgba(255, 150, 150)
            } else if (p.color === 'white') {
                r = 1.0; g = 1.0; b = 1.0;
            } else if (typeof p.color === 'string' && p.color.startsWith('#')) {
                r = parseInt(p.color.slice(1, 3), 16) / 255;
                g = parseInt(p.color.slice(3, 5), 16) / 255;
                b = parseInt(p.color.slice(5, 7), 16) / 255;
            } else {
                r = 1.0; g = 1.0; b = 1.0;
            }

            this.colorData[i3] = r;
            this.colorData[i3 + 1] = g;
            this.colorData[i3 + 2] = b;

            // Twinkle
            this.twinkleData[i2] = p.twinklePhase || 0;
            this.twinkleData[i2 + 1] = p.twinkleSpeed || 0;

            // Brightness
            this.brightnessData[i2] = p.brightness || 1.0;
            this.brightnessData[i2 + 1] = p.pulseBoost || 0;
        }

        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this.positionData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, this.sizeData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, this.colorData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.twinkle);
        gl.bufferData(gl.ARRAY_BUFFER, this.twinkleData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
        gl.bufferData(gl.ARRAY_BUFFER, this.brightnessData, gl.DYNAMIC_DRAW);

        this.positionsDirty = false;
        this.brightnessDirty = false;
    }

    /**
     * Update positions (for moving particles)
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
     * Render
     */
    render(time, globalPulse, moonPos, moonRadius) {
        const gl = this.gl;
        if (!gl || this.particleCount === 0) return;

        gl.useProgram(this.program);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.globalPulse, globalPulse);

        if (moonPos) {
            gl.uniform2f(this.uniforms.moonPos, moonPos.x, moonPos.y);
            gl.uniform1f(this.uniforms.moonRadius, moonRadius || 0);
        } else {
            gl.uniform2f(this.uniforms.moonPos, -1000, -1000); // Far away
            gl.uniform1f(this.uniforms.moonRadius, 0);
        }

        // Bind buffers
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.enableVertexAttribArray(this.attributes.size);
        gl.vertexAttribPointer(this.attributes.size, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attributes.color);
        gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.twinkle);
        gl.enableVertexAttribArray(this.attributes.twinkle);
        gl.vertexAttribPointer(this.attributes.twinkle, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
        gl.enableVertexAttribArray(this.attributes.brightness);
        gl.vertexAttribPointer(this.attributes.brightness, 2, gl.FLOAT, false, 0, 0);

        // Clear (transparent)
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Draw
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    destroy() {
        const gl = this.gl;
        if (!gl) return;

        Object.values(this.buffers).forEach(buffer => {
            if (buffer) gl.deleteBuffer(buffer);
        });

        if (this.program) {
            gl.deleteProgram(this.program);
        }

        this.gl = null;
    }
}
