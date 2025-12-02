/**
 * WebGL Snow Renderer - GPU-accelerated snow rendering
 * 
 * Adapted from WebGL Star Renderer.
 * Renders snow particles using point sprites for high performance.
 */

export default class WebGLSnowRenderer {
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
        this.opacityData = null;       // opacity per particle

        // Dirty flags
        this.positionsDirty = true;
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // Standard alpha blending for snow

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
            attribute float aOpacity;
            
            uniform vec2 uResolution;
            
            varying float vOpacity;
            varying float vSize;
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                vOpacity = aOpacity;
                vSize = aSize;
                
                // Point size (in pixels)
                gl_PointSize = vSize * 2.0; // Scale up slightly for softness
            }
        `;

        // Fragment shader - soft circular snowflake
        const fragmentShaderSource = `
            precision highp float;
            
            varying float vOpacity;
            varying float vSize;
            
            void main() {
                // Distance from center of point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft circular falloff
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Snow color (white/bluish)
                vec3 color = vec3(0.94, 0.96, 1.0); // Slightly bluish white
                
                gl_FragColor = vec4(color, alpha * vOpacity);
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
            opacity: gl.getAttribLocation(this.program, 'aOpacity'),
        };

        // Get uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'uResolution'),
        };

        return true;
    }

    initBuffers() {
        const gl = this.gl;

        this.buffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
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
        this.opacityData = new Float32Array(count);
    }

    /**
     * Update particle data from theme's particle array
     */
    updateParticles(particles) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(particles.length, this.maxParticles);
        this.particleCount = count;

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;

            this.positionData[i2] = p.x;
            this.positionData[i2 + 1] = p.y;
            this.sizeData[i] = p.size;
            this.opacityData[i] = p.opacity;
        }

        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, this.positionData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, this.sizeData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.opacity);
        gl.bufferData(gl.ARRAY_BUFFER, this.opacityData, gl.DYNAMIC_DRAW);
    }

    /**
     * Render all particles
     */
    render() {
        const gl = this.gl;
        if (!gl || this.particleCount === 0) return;

        gl.useProgram(this.program);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);

        // Bind position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

        // Bind size buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.enableVertexAttribArray(this.attributes.size);
        gl.vertexAttribPointer(this.attributes.size, 1, gl.FLOAT, false, 0, 0);

        // Bind opacity buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.opacity);
        gl.enableVertexAttribArray(this.attributes.opacity);
        gl.vertexAttribPointer(this.attributes.opacity, 1, gl.FLOAT, false, 0, 0);

        // Clear with transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Draw particles
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
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
