/**
 * WebGL Rain Renderer - GPU-accelerated rain rendering
 * 
 * Renders rain streaks using dynamic geometry (quads) for high performance.
 */

export default class WebGLRainRenderer {
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
        // Each particle (drop) needs 6 vertices (2 triangles)
        // Each vertex needs: x, y, u, v, opacity
        this.vertexData = null;
        this.vertexCount = 0;

        // Constants
        this.FLOATS_PER_VERTEX = 5; // x, y, u, v, opacity
        this.BYTES_PER_VERTEX = this.FLOATS_PER_VERTEX * 4;
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

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
            attribute vec2 aTexCoord;
            attribute float aOpacity;
            
            uniform vec2 uResolution;
            
            varying vec2 vTexCoord;
            varying float vOpacity;
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                vTexCoord = aTexCoord;
                vOpacity = aOpacity;
            }
        `;

        // Fragment shader - gradient streak
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec2 vTexCoord;
            varying float vOpacity;
            
            void main() {
                // vTexCoord.y goes from 0 (head) to 1 (tail)
                // or 0 (top) to 1 (bottom) depending on mapping
                
                // Gradient: Fade out towards the tail
                // We assume vTexCoord.y = 0 is the head (bright), 1 is the tail (faded)
                
                float alpha = 1.0 - vTexCoord.y;
                alpha = pow(alpha, 0.5); // Adjust falloff
                
                // Horizontal fade (roundness)
                float xDist = abs(vTexCoord.x - 0.5) * 2.0;
                float shapeAlpha = 1.0 - smoothstep(0.5, 1.0, xDist);
                
                // Color: Bluish white
                vec3 color = vec3(0.85, 0.92, 1.0);
                
                // Glow at the head
                if (vTexCoord.y < 0.1) {
                    color += vec3(0.15, 0.08, 0.0); // Slight extra brightness
                }

                gl_FragColor = vec4(color, alpha * shapeAlpha * vOpacity);
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
            texCoord: gl.getAttribLocation(this.program, 'aTexCoord'),
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
        this.buffers.vertex = gl.createBuffer();
    }

    /**
     * Allocate buffers for particles
     */
    allocateParticles(count) {
        this.maxParticles = count;
        // 6 vertices per particle
        this.vertexData = new Float32Array(count * 6 * this.FLOATS_PER_VERTEX);
    }

    /**
     * Update particle data from theme's particle array
     * @param {Array} drops - Array of drop objects
     * @param {number} windForce - Current wind force
     * @param {number} gustIntensity - Current gust intensity
     */
    updateParticles(drops, windForce, gustIntensity) {
        const gl = this.gl;
        if (!gl) return;

        let vIndex = 0;
        const count = Math.min(drops.length, this.maxParticles);

        for (let i = 0; i < count; i++) {
            const drop = drops[i];

            // Calculate visual properties (matching Canvas2D logic)
            const depthScale = 0.4 + drop.z * 0.6;
            const scaledR = drop.r * depthScale;

            const gustLengthMultiplier = 1 + gustIntensity * 0.4;
            const scaledLength = drop.length * depthScale * (1 + Math.abs(windForce) * 0.1) * gustLengthMultiplier;
            const streakSkew = windForce * (3 + gustIntensity * 2);

            // Head position (x, y)
            const headX = drop.x;
            const headY = drop.y;

            // Tail position
            const tailX = drop.x - streakSkew;
            const tailY = drop.y - scaledLength;

            // Width vector (perpendicular to direction)
            // Direction vector
            const dx = headX - tailX;
            const dy = headY - tailY;
            const len = Math.sqrt(dx * dx + dy * dy);

            // Normalized perpendicular vector (-dy, dx)
            // We want a fixed width based on scaledR
            const width = scaledR * 0.8; // Slightly wider for softness
            const px = (-dy / len) * width;
            const py = (dx / len) * width;

            const opacity = drop.opacity;

            // Quad vertices:
            // 0: Head Left
            // 1: Head Right
            // 2: Tail Left
            // 3: Tail Right

            // Triangle 1: 0, 1, 2
            // Triangle 2: 1, 3, 2

            const hlx = headX - px; const hly = headY - py;
            const hrx = headX + px; const hry = headY + py;
            const tlx = tailX - px; const tly = tailY - py;
            const trx = tailX + px; const tryCoord = tailY + py;

            // Vertex 0 (Head Left)
            this.vertexData[vIndex++] = hlx;
            this.vertexData[vIndex++] = hly;
            this.vertexData[vIndex++] = 0.0; // u
            this.vertexData[vIndex++] = 0.0; // v (head)
            this.vertexData[vIndex++] = opacity;

            // Vertex 1 (Head Right)
            this.vertexData[vIndex++] = hrx;
            this.vertexData[vIndex++] = hry;
            this.vertexData[vIndex++] = 1.0; // u
            this.vertexData[vIndex++] = 0.0; // v (head)
            this.vertexData[vIndex++] = opacity;

            // Vertex 2 (Tail Left)
            this.vertexData[vIndex++] = tlx;
            this.vertexData[vIndex++] = tly;
            this.vertexData[vIndex++] = 0.0; // u
            this.vertexData[vIndex++] = 1.0; // v (tail)
            this.vertexData[vIndex++] = opacity;

            // Vertex 1 (Head Right) - Repeated
            this.vertexData[vIndex++] = hrx;
            this.vertexData[vIndex++] = hry;
            this.vertexData[vIndex++] = 1.0;
            this.vertexData[vIndex++] = 0.0;
            this.vertexData[vIndex++] = opacity;

            // Vertex 3 (Tail Right)
            this.vertexData[vIndex++] = trx;
            this.vertexData[vIndex++] = tryCoord;
            this.vertexData[vIndex++] = 1.0;
            this.vertexData[vIndex++] = 1.0;
            this.vertexData[vIndex++] = opacity;

            // Vertex 2 (Tail Left) - Repeated
            this.vertexData[vIndex++] = tlx;
            this.vertexData[vIndex++] = tly;
            this.vertexData[vIndex++] = 0.0;
            this.vertexData[vIndex++] = 1.0;
            this.vertexData[vIndex++] = opacity;
        }

        this.vertexCount = count * 6;

        // Upload to GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vertex);
        gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.subarray(0, vIndex), gl.DYNAMIC_DRAW);
    }

    /**
     * Render all particles
     */
    render() {
        const gl = this.gl;
        if (!gl || this.vertexCount === 0) return;

        gl.useProgram(this.program);

        // Clear with transparent
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);

        // Bind vertex buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.vertex);

        // Setup attributes
        // x, y
        gl.enableVertexAttribArray(this.attributes.position);
        gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, this.BYTES_PER_VERTEX, 0);

        // u, v
        gl.enableVertexAttribArray(this.attributes.texCoord);
        gl.vertexAttribPointer(this.attributes.texCoord, 2, gl.FLOAT, false, this.BYTES_PER_VERTEX, 8); // 2 floats * 4 bytes

        // opacity
        gl.enableVertexAttribArray(this.attributes.opacity);
        gl.vertexAttribPointer(this.attributes.opacity, 1, gl.FLOAT, false, this.BYTES_PER_VERTEX, 16); // 4 floats * 4 bytes

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
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

        if (this.buffers.vertex) gl.deleteBuffer(this.buffers.vertex);
        if (this.program) gl.deleteProgram(this.program);

        this.gl = null;
    }
}
