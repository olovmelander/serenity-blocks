
export default class WebGLSynthwaveEffects {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.buffer = null;
        this.maxParticles = 2000;
        this.vertexData = new Float32Array(this.maxParticles * 4 * 8); // 4 verts per particle, 8 floats per vert
        this.indexData = null;
        this.count = 0;
    }

    init() {
        const gl = this.canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: false,
            antialias: false,
        }) || this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');

        if (!gl) return false;
        this.gl = gl;

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending usually looks best for these effects

        this.initShaders();
        this.initBuffers();

        return true;
    }

    initShaders() {
        const gl = this.gl;
        const vsSource = `
            precision highp float;
            attribute vec2 aPosition;
            attribute vec2 aTexCoord;
            attribute vec4 aColor;
            
            uniform vec2 uResolution;
            
            varying vec2 vTexCoord;
            varying vec4 vColor;
            
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                vTexCoord = aTexCoord;
                vColor = aColor;
            }
        `;

        const fsSource = `
            precision highp float;
            varying vec2 vTexCoord;
            varying vec4 vColor;
            
            void main() {
                // Simple soft particle (circle)
                // Distance from center (0.5, 0.5)
                vec2 coord = vTexCoord - vec2(0.5);
                float dist = length(coord) * 2.0;
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // For streaks (rectangles), we might want full alpha or different shape
                // We can encode shape type in color alpha or separate attribute if needed
                // But for now, let's assume everything is a soft glowy particle or streak
                // If vTexCoord.x is > 1.0, it's a special flag? No, let's keep it simple.
                
                // If it's a streak (very wide), we probably want it to be a solid bar with fade at ends
                // But reusing the circle shader makes streaks look like stretched ovals, which is fine for "laser" look.
                
                gl_FragColor = vColor * alpha;
            }
        `;

        // Create program
        const createShader = (type, source) => {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(shader));
                return null;
            }
            return shader;
        };

        const vs = createShader(gl.VERTEX_SHADER, vsSource);
        const fs = createShader(gl.FRAGMENT_SHADER, fsSource);

        this.program = gl.createProgram();
        gl.attachShader(this.program, vs);
        gl.attachShader(this.program, fs);
        gl.linkProgram(this.program);
    }

    initBuffers() {
        const gl = this.gl;
        this.buffer = gl.createBuffer();

        // Indices for quads
        const indices = new Uint16Array(this.maxParticles * 6);
        for (let i = 0; i < this.maxParticles; i++) {
            const v = i * 4;
            const idx = i * 6;
            indices[idx] = v;
            indices[idx + 1] = v + 1;
            indices[idx + 2] = v + 2;
            indices[idx + 3] = v;
            indices[idx + 4] = v + 2;
            indices[idx + 5] = v + 3;
        }

        this.indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    hexToRgb(hex) {
        // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
        const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
        hex = hex.replace(shorthandRegex, (m, r, g, b) => {
            return r + r + g + g + b + b;
        });

        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16) / 255,
            g: parseInt(result[2], 16) / 255,
            b: parseInt(result[3], 16) / 255
        } : { r: 1, g: 1, b: 1 };
    }

    render(streaks, bursts, particles, sparkles) {
        const gl = this.gl;
        if (!gl || !this.program) return;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        const uResolution = gl.getUniformLocation(this.program, 'uResolution');
        gl.uniform2f(uResolution, this.canvas.width, this.canvas.height);

        let idx = 0;
        const data = this.vertexData;

        const addQuad = (x, y, w, h, r, g, b, a, rotation) => {
            if (idx >= data.length) return;

            // Corners relative to center
            const hw = w / 2;
            const hh = h / 2;

            let x1 = -hw, y1 = -hh;
            let x2 = hw, y2 = -hh;
            let x3 = hw, y3 = hh;
            let x4 = -hw, y4 = hh;

            // Rotate if needed
            if (rotation !== 0) {
                const c = Math.cos(rotation);
                const s = Math.sin(rotation);

                const rx1 = x1 * c - y1 * s; y1 = x1 * s + y1 * c; x1 = rx1;
                const rx2 = x2 * c - y2 * s; y2 = x2 * s + y2 * c; x2 = rx2;
                const rx3 = x3 * c - y3 * s; y3 = x3 * s + y3 * c; x3 = rx3;
                const rx4 = x4 * c - y4 * s; y4 = x4 * s + y4 * c; x4 = rx4;
            }

            // Translate
            x1 += x; y1 += y;
            x2 += x; y2 += y;
            x3 += x; y3 += y;
            x4 += x; y4 += y;

            // Push vertices (x, y, u, v, r, g, b, a)
            // BL
            data[idx++] = x1; data[idx++] = y1; data[idx++] = 0; data[idx++] = 0;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;

            // BR
            data[idx++] = x2; data[idx++] = y2; data[idx++] = 1; data[idx++] = 0;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;

            // TR
            data[idx++] = x3; data[idx++] = y3; data[idx++] = 1; data[idx++] = 1;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;

            // TL
            data[idx++] = x4; data[idx++] = y4; data[idx++] = 0; data[idx++] = 1;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;
        };

        // 1. Retro Streaks
        if (streaks) {
            for (const s of streaks) {
                const rgb = this.hexToRgb(s.color);
                addQuad(s.x, s.y, s.width, s.height, rgb.r, rgb.g, rgb.b, s.life * 1.2, 0);
            }
        }

        // 2. Horizon Bursts
        if (bursts) {
            for (const b of bursts) {
                const rgb = this.hexToRgb(b.color);
                for (const p of b.particles) {
                    addQuad(p.x, p.y, p.size * 2, p.size * 2, rgb.r, rgb.g, rgb.b, p.life, 0);
                }
            }
        }

        // 3. Retro Particles
        if (particles) {
            for (const p of particles) {
                const rgb = this.hexToRgb(p.color);
                // Use rotation if available
                addQuad(p.x, p.y, p.size * 2, p.size * 2, rgb.r, rgb.g, rgb.b, p.life, p.rotation || 0);
            }
        }

        // 4. Sun Sparkles
        if (sparkles) {
            for (const s of sparkles) {
                const rgb = this.hexToRgb(s.color);
                // Sparkles are small, bright, and rotated
                addQuad(s.x, s.y, s.size * 2, s.size * 2, rgb.r, rgb.g, rgb.b, s.life, s.rotation || 0);
            }
        }

        if (idx > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, idx), gl.DYNAMIC_DRAW);

            const aPosition = gl.getAttribLocation(this.program, 'aPosition');
            const aTexCoord = gl.getAttribLocation(this.program, 'aTexCoord');
            const aColor = gl.getAttribLocation(this.program, 'aColor');

            const stride = 8 * 4; // 8 floats * 4 bytes
            gl.enableVertexAttribArray(aPosition);
            gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);

            gl.enableVertexAttribArray(aTexCoord);
            gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 2 * 4);

            gl.enableVertexAttribArray(aColor);
            gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 4 * 4);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

            const count = idx / 8 / 4; // floats / floats_per_vert / verts_per_quad
            gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);
        }
    }
}
