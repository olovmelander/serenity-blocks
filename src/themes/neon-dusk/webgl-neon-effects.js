
export default class WebGLNeonEffects {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.program = null;
        this.buffer = null;
        this.maxParticles = 4000; // Increased limit for all effects
        this.vertexData = new Float32Array(this.maxParticles * 4 * 9); // 4 verts, 9 floats per vert (x,y,u,v,r,g,b,a,type)
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending

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
            attribute float aType; // 0=Circle, 1=Ring, 2=Rect, 3=Glitch
            
            uniform vec2 uResolution;
            
            varying vec2 vTexCoord;
            varying vec4 vColor;
            varying float vType;
            
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                vTexCoord = aTexCoord;
                vColor = aColor;
                vType = aType;
            }
        `;

        const fsSource = `
            precision highp float;
            varying vec2 vTexCoord;
            varying vec4 vColor;
            varying float vType;
            
            float random(vec2 st) {
                return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
            }

            void main() {
                vec2 coord = vTexCoord - vec2(0.5);
                float dist = length(coord) * 2.0; // 0 to 1 edge
                float alpha = 0.0;
                
                if (vType < 0.5) {
                    // Type 0: Soft Circle
                    alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                    alpha = pow(alpha, 1.5); // Sharper falloff
                } else if (vType < 1.5) {
                    // Type 1: Ring
                    // Ring between 0.6 and 0.9
                    float ring = smoothstep(0.5, 0.7, dist) - smoothstep(0.8, 1.0, dist);
                    alpha = ring;
                } else if (vType < 2.5) {
                    // Type 2: Squared Particle with Glow
                    vec2 d = abs(coord) * 2.0;
                    
                    // Sharp core
                    float core = (1.0 - smoothstep(0.9, 1.0, d.x)) * (1.0 - smoothstep(0.9, 1.0, d.y));
                    
                    // Soft glow
                    float glow = (1.0 - smoothstep(0.4, 1.0, d.x)) * (1.0 - smoothstep(0.4, 1.0, d.y));
                    
                    // Combine - Core is bright, glow is intense
                    alpha = core + glow * 2.5;
                } else {
                    // Type 3: Glitch/Noise
                    float noise = random(vTexCoord + vec2(vColor.r, vColor.g)); // Static noise
                    if (noise > 0.5) alpha = 0.8;
                    else alpha = 0.0;
                    
                    // Scanline effect
                    if (mod(vTexCoord.y * 10.0, 1.0) > 0.5) alpha *= 0.5;
                }
                
                gl_FragColor = vColor * alpha;
            }
        `;

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

    render(bursts, arcs, scanlines, rings, vortexes, glitches, ambientParticles) {
        const gl = this.gl;
        if (!gl || !this.program) return;

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        const uResolution = gl.getUniformLocation(this.program, 'uResolution');
        gl.uniform2f(uResolution, this.canvas.width, this.canvas.height);

        let idx = 0;
        const data = this.vertexData;

        const addQuad = (x, y, w, h, r, g, b, a, rotation, type) => {
            if (idx >= data.length) return;

            const hw = w / 2;
            const hh = h / 2;

            let x1 = -hw, y1 = -hh;
            let x2 = hw, y2 = -hh;
            let x3 = hw, y3 = hh;
            let x4 = -hw, y4 = hh;

            if (rotation !== 0) {
                const c = Math.cos(rotation);
                const s = Math.sin(rotation);

                const rx1 = x1 * c - y1 * s; y1 = x1 * s + y1 * c; x1 = rx1;
                const rx2 = x2 * c - y2 * s; y2 = x2 * s + y2 * c; x2 = rx2;
                const rx3 = x3 * c - y3 * s; y3 = x3 * s + y3 * c; x3 = rx3;
                const rx4 = x4 * c - y4 * s; y4 = x4 * s + y4 * c; x4 = rx4;
            }

            x1 += x; y1 += y;
            x2 += x; y2 += y;
            x3 += x; y3 += y;
            x4 += x; y4 += y;

            // BL
            data[idx++] = x1; data[idx++] = y1; data[idx++] = 0; data[idx++] = 0;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;
            data[idx++] = type;

            // BR
            data[idx++] = x2; data[idx++] = y2; data[idx++] = 1; data[idx++] = 0;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;
            data[idx++] = type;

            // TR
            data[idx++] = x3; data[idx++] = y3; data[idx++] = 1; data[idx++] = 1;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;
            data[idx++] = type;

            // TL
            data[idx++] = x4; data[idx++] = y4; data[idx++] = 0; data[idx++] = 1;
            data[idx++] = r; data[idx++] = g; data[idx++] = b; data[idx++] = a;
            data[idx++] = type;
        };

        // 0. Ambient Particles (Type 0 - Soft Circle or Type 2 - Square)
        if (ambientParticles) {
            for (const p of ambientParticles) {
                const rgb = this.hexToRgb(p.color);
                // Render as small squares (Type 2) for digital look
                addQuad(p.x, p.y, p.size * 2, p.size * 2, rgb.r, rgb.g, rgb.b, p.life * 1.0, 0, 2);
            }
        }

        // 1. Neon Bursts (Type 0 or custom)
        if (bursts) {
            for (const p of bursts) {
                const rgb = this.hexToRgb(p.color);
                const type = p.type !== undefined ? p.type : 0;
                addQuad(p.x, p.y, p.size * 2, p.size * 2, rgb.r, rgb.g, rgb.b, p.life, 0, type);
            }
        }

        // 2. Electric Arcs (Type 2 - Rect)
        if (arcs) {
            for (const arc of arcs) {
                const rgb = this.hexToRgb(arc.color);
                if (arc.segments) {
                    for (let i = 0; i < arc.segments.length - 1; i++) {
                        const p1 = arc.segments[i];
                        const p2 = arc.segments[i + 1];
                        const dx = p2.x - p1.x;
                        const dy = p2.y - p1.y;
                        const len = Math.sqrt(dx * dx + dy * dy);
                        const angle = Math.atan2(dy, dx);
                        const cx = (p1.x + p2.x) / 2;
                        const cy = (p1.y + p2.y) / 2;

                        addQuad(cx, cy, len, arc.width, rgb.r, rgb.g, rgb.b, arc.life, angle, 2);
                    }
                }
            }
        }

        // 3. Scanlines (Type 2 - Rect)
        if (scanlines) {
            for (const line of scanlines) {
                const rgb = this.hexToRgb(line.color);
                // Full width rect
                addQuad(this.canvas.width / 2, line.y, this.canvas.width, line.height, rgb.r, rgb.g, rgb.b, line.opacity * line.life, 0, 2);
            }
        }

        // 4. Hologram Rings (Type 1 - Ring)
        if (rings) {
            for (const ring of rings) {
                const rgb = this.hexToRgb(ring.color);
                addQuad(ring.x, ring.y, ring.radius * 2, ring.radius * 2, rgb.r, rgb.g, rgb.b, ring.life, 0, 1);
            }
        }

        // 5. Cyber Vortexes (Type 0 - Particles)
        if (vortexes) {
            for (const v of vortexes) {
                const rgb = this.hexToRgb(v.color);
                for (const p of v.particles) {
                    // Calculate particle pos based on vortex center + angle/radius
                    const px = v.x + Math.cos(p.angle) * p.radius;
                    const py = v.y + Math.sin(p.angle) * p.radius;
                    addQuad(px, py, 4, 4, rgb.r, rgb.g, rgb.b, v.life, 0, 0);
                }
            }
        }

        // 6. Glitch Pulses (Type 3 - Glitch)
        if (glitches) {
            for (const g of glitches) {
                const rgb = this.hexToRgb(g.color);
                addQuad(g.x, g.y, g.width, g.height, rgb.r, rgb.g, rgb.b, g.life, 0, 3);
            }
        }

        if (idx > 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, idx), gl.DYNAMIC_DRAW);

            const stride = 9 * 4; // 9 floats * 4 bytes

            const aPosition = gl.getAttribLocation(this.program, 'aPosition');
            gl.enableVertexAttribArray(aPosition);
            gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, stride, 0);

            const aTexCoord = gl.getAttribLocation(this.program, 'aTexCoord');
            gl.enableVertexAttribArray(aTexCoord);
            gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, stride, 2 * 4);

            const aColor = gl.getAttribLocation(this.program, 'aColor');
            gl.enableVertexAttribArray(aColor);
            gl.vertexAttribPointer(aColor, 4, gl.FLOAT, false, stride, 4 * 4);

            const aType = gl.getAttribLocation(this.program, 'aType');
            gl.enableVertexAttribArray(aType);
            gl.vertexAttribPointer(aType, 1, gl.FLOAT, false, stride, 8 * 4);

            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

            const count = idx / 9 / 4;
            gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);
        }
    }
}
