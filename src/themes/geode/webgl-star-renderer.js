/**
 * WebGL Star Renderer - GPU-accelerated star field rendering
 *
 * Inspired by WebGL Fluid Simulation techniques, this renderer:
 * - Renders ALL stars in a single GPU draw call using point sprites
 * - Moves twinkle/brightness calculations to fragment shader (parallel on GPU)
 * - Achieves 60fps even with 10,000+ stars
 */

export default class WebGLStarRenderer {
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
        this.positionData = null; // x, y per star
        this.sizeData = null; // size per star
        this.colorData = null; // r, g, b per star
        this.twinkleData = null; // phase, speed per star
        this.brightnessData = null; // base brightness, ripple boost per star

        // Dirty flags for partial updates
        this.positionsDirty = true;
        this.brightnessDirty = true;

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

        // Enable blending for transparent stars
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
        const { gl } = this;

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
                float rippleBoost = aBrightness.y;
                
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
        };

        return true;
    }

    initBuffers() {
        const { gl } = this;

        this.buffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
            twinkle: gl.createBuffer(),
            brightness: gl.createBuffer(),
        };
    }

    /**
     * Set the color palette (hex strings)
     */
    setColorPalette(colors) {
        this.colorPalette = colors.map((hex) => {
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
        const { gl } = this;
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
            const colorIdx = this.colorPalette.findIndex((_, idx) => this.colorPalette[idx] && star.color === this.getHexFromRGB(this.colorPalette[idx]));
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
        const { gl } = this;
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
        const { gl } = this;
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
     */
    render(time, pulseIntensity, ambientPulse, brightnessThreshold, enableGlow) {
        const { gl } = this;
        if (!gl || this.starCount === 0) return;

        gl.useProgram(this.program);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.pulseIntensity, pulseIntensity);
        gl.uniform1f(this.uniforms.ambientPulse, ambientPulse);
        gl.uniform1f(this.uniforms.brightnessThreshold, brightnessThreshold);
        gl.uniform1f(this.uniforms.enableGlow, enableGlow ? 1.0 : 0.0);

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
        const { gl } = this;
        if (!gl) return;

        // Delete buffers
        Object.values(this.buffers).forEach((buffer) => {
            if (buffer) gl.deleteBuffer(buffer);
        });

        // Delete program
        if (this.program) {
            gl.deleteProgram(this.program);
        }

        this.gl = null;
    }
}
