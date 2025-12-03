/**
 * WebGL Wolf Renderer - GPU-accelerated star field rendering for Wolfhour Theme
 * 
 * Adapted from Geode Theme's WebGLStarRenderer.
 * - Renders ALL stars in a single GPU draw call using point sprites
 * - Moves twinkle/brightness calculations to fragment shader
 * - Optimized for Wolfhour's silver/mystical aesthetic
 */

export default class WebGLWolfRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.buffers = {};
        this.uniforms = {};
        this.attributes = {};

        // Star data
        this.starCount = 0;
        this.maxStars = 0;

        // Typed arrays for GPU upload
        this.positionData = null;      // x, y per star
        this.sizeData = null;          // size per star
        this.colorData = null;         // r, g, b per star
        this.twinkleData = null;       // phase, speed per star
        this.brightnessData = null;    // base brightness, ripple boost per star

        // Dirty flags for partial updates
        this.positionsDirty = true;
        this.brightnessDirty = true;

        // Color palette as normalized RGB
        this.colorPalette = [];

        // Particle System Data
        this.maxParticles = 2000;
        this.particleCount = 0;
        this.particleProgram = null;
        this.particleBuffers = {};
        this.particleAttributes = {};
        this.particleUniforms = {};

        // Particle Arrays
        this.pPositionData = new Float32Array(this.maxParticles * 2);
        this.pSizeData = new Float32Array(this.maxParticles);
        this.pColorData = new Float32Array(this.maxParticles * 4); // r,g,b,a
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

        // Enable blending for transparent stars
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glow effect

        // Compile shaders
        if (!this.initShaders()) {
            return false;
        }

        // Create buffers
        this.initBuffers();

        // Init Particle System
        this.initParticleShaders();
        this.initParticleBuffers();

        return true;
    }

    initShaders() {
        const gl = this.gl;

        // Vertex shader - positions stars and passes data to fragment shader
        const vertexShaderSource = `
            precision highp float;
            
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec3 aColor;
            attribute vec2 aTwinkle;      // x = phase, y = speed
            attribute vec2 aBrightness;   // x = base, y = ripple boost
            
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uPulseIntensity;
            uniform float uAmbientPulse;
            
            uniform vec4 uRipples[5];     // x, y, radius, intensity
            uniform int uRippleCount;
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                // Calculate twinkle (scale time to match Canvas2D frame-by-frame accumulation)
                float phase = aTwinkle.x + uTime * aTwinkle.y * 62.5;
                float twinkle = sin(phase) * 0.4 + 0.6;
                
                // Calculate final brightness
                float pulseBoost = 1.0 + uPulseIntensity * 0.4;
                float baseBrightness = aBrightness.x * twinkle * pulseBoost * uAmbientPulse;
                
                // Calculate ripple boost on GPU
                float rippleBoost = aBrightness.y;
                
                for (int i = 0; i < 5; i++) {
                    if (i >= uRippleCount) break;
                    vec4 r = uRipples[i]; // x, y, radius, intensity
                    float dist = distance(aPosition, r.xy);
                    float width = 60.0 + r.w * 10.0; // Approximate width based on intensity or fixed
                    
                    if (dist >= r.z && dist <= r.z + width) {
                        float relPos = (dist - r.z) / width;
                        float intensity = sin(relPos * 3.14159) * r.w;
                        rippleBoost += intensity * 2.0;
                    }
                }
                
                vBrightness = min(baseBrightness + rippleBoost, 1.2);
                vColor = aColor;
                
                // Size with ripple boost
                float sizeBoost = 1.0 + rippleBoost * 0.8;
                vSize = aSize * sizeBoost;
                
                // Point size (in pixels)
                gl_PointSize = vSize * 2.5;
            }
        `;

        // Fragment shader - renders circular star with glow
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            
            uniform float uBrightnessThreshold;
            uniform float uEnableGlow;
            
            void main() {
                // Skip very dim stars
                if (vBrightness < uBrightnessThreshold) {
                    discard;
                }
                
                // Distance from center of point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft circular falloff
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Add glow effect for larger stars
                float glow = 0.0;
                if (uEnableGlow > 0.5 && vSize > 2.0) {
                    glow = exp(-dist * 2.0) * 0.4;
                }
                
                float finalAlpha = (alpha + glow) * vBrightness;
                
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
            pulseIntensity: gl.getUniformLocation(this.program, 'uPulseIntensity'),
            ambientPulse: gl.getUniformLocation(this.program, 'uAmbientPulse'),
            brightnessThreshold: gl.getUniformLocation(this.program, 'uBrightnessThreshold'),
            enableGlow: gl.getUniformLocation(this.program, 'uEnableGlow'),
            ripples: gl.getUniformLocation(this.program, 'uRipples'),
            rippleCount: gl.getUniformLocation(this.program, 'uRippleCount'),
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

    initParticleShaders() {
        const gl = this.gl;

        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec4 aColor;
            uniform vec2 uResolution;
            varying vec4 vColor;
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                gl_PointSize = aSize;
                vColor = aColor;
            }
        `;

        const fsSource = `
            precision highp float;
            varying vec4 vColor;
            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord) * 2.0;
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                if (alpha < 0.01) discard;
                // Additive blending: rgb * alpha
                gl_FragColor = vec4(vColor.rgb * alpha * vColor.a, alpha * vColor.a);
            }
        `;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);

        this.particleProgram = gl.createProgram();
        gl.attachShader(this.particleProgram, vs);
        gl.attachShader(this.particleProgram, fs);
        gl.linkProgram(this.particleProgram);

        this.particleAttributes = {
            position: gl.getAttribLocation(this.particleProgram, 'aPosition'),
            size: gl.getAttribLocation(this.particleProgram, 'aSize'),
            color: gl.getAttribLocation(this.particleProgram, 'aColor'),
        };
        this.particleUniforms = {
            resolution: gl.getUniformLocation(this.particleProgram, 'uResolution'),
        };
    }

    initParticleBuffers() {
        const gl = this.gl;
        this.particleBuffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
        };
    }

    /**
     * Set the color palette (hex strings)
     */
    setColorPalette(colors) {
        this.colorPalette = colors.map(hex => {
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            return [r, g, b];
        });
    }

    /**
     * Allocate buffers for stars
     */
    allocateStars(count) {
        this.maxStars = count;
        this.starCount = 0;

        // Allocate typed arrays
        this.positionData = new Float32Array(count * 2);
        this.sizeData = new Float32Array(count);
        this.colorData = new Float32Array(count * 3);
        this.twinkleData = new Float32Array(count * 2);
        this.brightnessData = new Float32Array(count * 2);
    }

    /**
     * Upload star data from theme's star array
     */
    uploadStars(stars) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(stars.length, this.maxStars);
        this.starCount = count;

        // Fill typed arrays from star objects
        for (let i = 0; i < count; i++) {
            const star = stars[i];
            const i2 = i * 2;
            const i3 = i * 3;

            // Position
            this.positionData[i2] = star.x;
            this.positionData[i2 + 1] = star.y;

            // Size
            this.sizeData[i] = star.size;

            // Color (find in palette or parse)
            const colorIdx = this.colorPalette.findIndex((_, idx) =>
                this.colorPalette[idx] && star.color === this.getHexFromRGB(this.colorPalette[idx])
            );
            if (colorIdx >= 0) {
                const [r, g, b] = this.colorPalette[colorIdx];
                this.colorData[i3] = r;
                this.colorData[i3 + 1] = g;
                this.colorData[i3 + 2] = b;
            } else {
                // Parse hex color
                const r = parseInt(star.color.slice(1, 3), 16) / 255;
                const g = parseInt(star.color.slice(3, 5), 16) / 255;
                const b = parseInt(star.color.slice(5, 7), 16) / 255;
                this.colorData[i3] = r;
                this.colorData[i3 + 1] = g;
                this.colorData[i3 + 2] = b;
            }

            // Twinkle (phase, speed)
            this.twinkleData[i2] = star.twinklePhase;
            this.twinkleData[i2 + 1] = star.twinkleSpeed;

            // Brightness (base, ripple boost)
            this.brightnessData[i2] = star.brightness;
            this.brightnessData[i2 + 1] = star.rippleBoost || 0;
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

    getHexFromRGB(rgb) {
        const r = Math.round(rgb[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(rgb[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(rgb[2] * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    /**
     * Update star positions (call each frame for drifting)
     */
    updatePositions(stars) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(stars.length, this.starCount);

        for (let i = 0; i < count; i++) {
            const i2 = i * 2;
            this.positionData[i2] = stars[i].x;
            this.positionData[i2 + 1] = stars[i].y;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positionData);
    }

    /**
     * Update brightness/ripple boost (call when ripples are active)
     */
    updateBrightness(stars) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(stars.length, this.starCount);

        for (let i = 0; i < count; i++) {
            const i2 = i * 2;
            this.brightnessData[i2] = stars[i].brightness;
            this.brightnessData[i2 + 1] = stars[i].rippleBoost || 0;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.brightnessData);
    }

    /**
     * Render all stars in a single draw call!
     * @param {number} time - Current animation time
     * @param {number} pulseIntensity - Global pulse intensity
     * @param {number} ambientPulse - Ambient pulse factor
     * @param {number} brightnessThreshold - Minimum brightness to render
     * @param {boolean} enableGlow - Whether to render glow
     * @param {Array} ripples - Array of active ripples {x, y, radius, width, life}
     */
    render(time, pulseIntensity, ambientPulse, brightnessThreshold, enableGlow, ripples = []) {
        const gl = this.gl;
        if (!gl || this.starCount === 0) return;

        gl.useProgram(this.program);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.pulseIntensity, pulseIntensity);
        gl.uniform1f(this.uniforms.ambientPulse, ambientPulse);
        gl.uniform1f(this.uniforms.brightnessThreshold, brightnessThreshold);
        gl.uniform1f(this.uniforms.enableGlow, enableGlow ? 1.0 : 0.0);

        // Upload ripples
        const rippleData = new Float32Array(20); // 5 ripples * 4 floats (x, y, radius, intensity)
        const count = Math.min(ripples.length, 5);

        for (let i = 0; i < count; i++) {
            const r = ripples[i];
            const idx = i * 4;
            rippleData[idx] = r.x;
            rippleData[idx + 1] = r.y;
            rippleData[idx + 2] = r.radius;
            // Calculate intensity based on life (and width packed if needed, but let's assume fixed width or pack it)
            // Let's pack width into intensity? No, let's just use life as intensity and hardcode width or pass it.
            // Actually, let's pass width in a separate uniform or assume it's roughly constant.
            // The theme uses `width: 60 + random`. 
            // Let's just use a fixed width in shader for optimization, or pass it.
            // We have 4 slots. x, y, radius, intensity.
            rippleData[idx + 3] = r.life;
        }

        gl.uniform4fv(this.uniforms.ripples, rippleData);
        gl.uniform1i(this.uniforms.rippleCount, count);

        // Bind position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

        // Bind size buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.enableVertexAttribArray(this.attributes.size);
        gl.vertexAttribPointer(this.attributes.size, 1, gl.FLOAT, false, 0, 0);

        // Bind color buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.enableVertexAttribArray(this.attributes.color);
        gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, 0, 0);

        // Bind twinkle buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.twinkle);
        gl.enableVertexAttribArray(this.attributes.twinkle);
        gl.vertexAttribPointer(this.attributes.twinkle, 2, gl.FLOAT, false, 0, 0);

        // Bind brightness buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
        gl.enableVertexAttribArray(this.attributes.brightness);
        gl.vertexAttribPointer(this.attributes.brightness, 2, gl.FLOAT, false, 0, 0);

        // Clear with transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Draw all stars in ONE call!
        gl.drawArrays(gl.POINTS, 0, this.starCount);
    }

    /**
     * Render generic particles
     * @param {Array} particles - Array of particle objects {x, y, size, hue, brightness, opacity}
     */
    renderParticles(particles) {
        const gl = this.gl;
        if (!gl || !this.particleProgram) return;

        const count = Math.min(particles.length, this.maxParticles);
        if (count === 0) return;

        // Update data arrays
        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;
            const i4 = i * 4;

            this.pPositionData[i2] = p.x;
            this.pPositionData[i2 + 1] = p.y;
            this.pSizeData[i] = p.size;

            // Convert HSL to RGB (approximate for performance)
            // H: 0-360, S: 0-100 (assume low saturation ~20%), L: brightness
            // Simplified: mostly white/blueish for Wolfhour
            // Let's just use a helper or simple conversion
            const h = p.hue;
            const s = 30; // Fixed low saturation for silver
            const l = p.brightness || 90;

            // Quick HSL to RGB conversion
            const c = (1 - Math.abs(2 * l / 100 - 1)) * (s / 100);
            const x = c * (1 - Math.abs((h / 60) % 2 - 1));
            const m = l / 100 - c / 2;

            let r = 0, g = 0, b = 0;
            if (0 <= h && h < 60) { r = c; g = x; b = 0; }
            else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
            else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
            else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
            else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
            else if (300 <= h && h < 360) { r = c; g = 0; b = x; }

            this.pColorData[i4] = r + m;
            this.pColorData[i4 + 1] = g + m;
            this.pColorData[i4 + 2] = b + m;
            this.pColorData[i4 + 3] = p.opacity;
        }

        gl.useProgram(this.particleProgram);
        gl.uniform2f(this.particleUniforms.resolution, this.canvas.width, this.canvas.height);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this.pPositionData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.particleAttributes.position);
        gl.vertexAttribPointer(this.particleAttributes.position, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, this.pSizeData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.particleAttributes.size);
        gl.vertexAttribPointer(this.particleAttributes.size, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, this.pColorData, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.particleAttributes.color);
        gl.vertexAttribPointer(this.particleAttributes.color, 4, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, count);
    }

    /**
     * Resize the canvas
     */
    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    /**
     * Clean up WebGL resources
     */
    destroy() {
        const gl = this.gl;
        if (!gl) return;

        // Delete buffers
        Object.values(this.buffers).forEach(buffer => {
            if (buffer) gl.deleteBuffer(buffer);
        });

        // Delete program
        if (this.program) {
            gl.deleteProgram(this.program);
        }

        this.gl = null;
    }
}
