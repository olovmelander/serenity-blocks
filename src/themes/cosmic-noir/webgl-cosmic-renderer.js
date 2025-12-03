/**
 * WebGL Cosmic Renderer - GPU-accelerated particle/star rendering for Cosmic Noir theme
 * 
 * Redesigned to support drifting black hole/planet with gravitational lensing and occlusion.
 * Now supports orbiting galaxy particles.
 */

export default class WebGLCosmicRenderer {
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
        this.positionData = null;      // x, y per particle (or orbit radius/angle for galaxy particles)
        this.sizeData = null;          // size per particle
        this.colorData = null;         // r, g, b per particle
        this.twinkleData = null;       // phase, speed per particle
        this.brightnessData = null;    // base brightness, pulse boost per particle
        this.typeData = null;          // 0 = star, 1 = galaxy particle

        // State
        this.blackHolePos = { x: 0, y: 0 };
        this.eventHorizonRadius = 0;
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
            
            attribute vec2 aPosition;     // For stars: x,y (0-1). For galaxy: radius, angle offset
            attribute float aSize;
            attribute vec3 aColor;
            attribute vec2 aTwinkle;      // x = phase, y = speed
            attribute vec2 aBrightness;   // x = base, y = pulse boost
            attribute float aType;        // 0.0 = Star, 1.0 = Galaxy Particle
            
            uniform vec2 uResolution;
            uniform float uTime;
            uniform float uGlobalPulse;
            uniform vec2 uBlackHolePos;
            uniform float uEventHorizonRadius;
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            varying vec2 vPos;
            varying float vDistToHole;
            varying float vType;
            
            void main() {
                vec2 finalPos;
                float sizeMult = 1.0;
                
                if (aType > 0.5) {
                    // Galaxy Particle (Orbiting)
                    // aPosition.x = radius, aPosition.y = angle offset
                    float radius = aPosition.x;
                    float angleOffset = aPosition.y;
                    
                    // Orbit speed depends on radius (closer = faster)
                    float speed = 200.0 / (radius + 50.0); 
                    float currentAngle = angleOffset + uTime * speed * 0.1;
                    
                    // Calculate position relative to black hole
                    vec2 offset = vec2(cos(currentAngle), sin(currentAngle)) * radius;
                    finalPos = uBlackHolePos + offset;
                    
                    // Galaxy particles pulse more
                    sizeMult = 1.0 + sin(uTime * 3.0 + angleOffset) * 0.2;
                } else {
                    // Star (Background)
                    // aPosition is 0-1 relative to screen
                    finalPos = aPosition * uResolution;
                    // Flip Y for stars to match screen coords if needed, but here we just use raw pixels
                    // Actually, let's keep consistent. If aPosition is 0-1, we multiply.
                    // If we uploaded pixels, we don't multiply.
                    // The previous code uploaded pixels. Let's assume pixels.
                    finalPos = aPosition; 
                }

                // Convert pixel coords to clip space
                vec2 clipSpace = (finalPos / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                vPos = finalPos;
                vType = aType;
                
                // Distance to black hole center
                float dist = distance(finalPos, uBlackHolePos);
                vDistToHole = dist;

                // Gravitational Lensing / Distortion (Stars only)
                float distortion = 1.0;
                if (aType < 0.5) {
                    float influenceRadius = uEventHorizonRadius * 3.0;
                    if (dist < influenceRadius && dist > uEventHorizonRadius) {
                        float factor = 1.0 - (dist - uEventHorizonRadius) / (influenceRadius - uEventHorizonRadius);
                        distortion = 1.0 + factor * 1.5; // Up to 2.5x size
                    }
                }
                
                // Calculate twinkle
                float phase = aTwinkle.x + uTime * aTwinkle.y * 50.0;
                float twinkle = sin(phase) * 0.3 + 0.7;
                
                // Global pulse effect
                float pulseEffect = 1.0 + uGlobalPulse * 0.3;
                
                // Final brightness
                float baseBrightness = aBrightness.x * twinkle * pulseEffect;
                float boost = aBrightness.y;
                
                vBrightness = min(baseBrightness + boost, 2.0);
                vColor = aColor;
                
                // Size pulsation
                float sizePulse = 1.0 + uGlobalPulse * 0.1;
                vSize = aSize * sizePulse * distortion * sizeMult;
                
                // Point size
                gl_PointSize = vSize * 2.5;
            }
        `;

        // Fragment shader
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 vColor;
            varying float vBrightness;
            varying float vSize;
            varying vec2 vPos;
            varying float vDistToHole;
            varying float vType;
            
            uniform vec2 uBlackHolePos;
            uniform float uEventHorizonRadius;
            
            void main() {
                // Event Horizon Occlusion (Stars only)
                // Stars behind the black hole are hidden
                if (vType < 0.5) {
                    if (vDistToHole < uEventHorizonRadius * 0.95) {
                        discard;
                    }
                }
                
                // Distance from center of point sprite
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft circular falloff
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Cosmic Noir Glow
                float glow = exp(-dist * 2.5) * 0.5;
                
                // Gravitational brightening near event horizon (Stars only)
                float lensingBrightness = 1.0;
                if (vType < 0.5 && vDistToHole < uEventHorizonRadius * 1.5) {
                    lensingBrightness = 1.0 + (1.0 - (vDistToHole - uEventHorizonRadius) / (uEventHorizonRadius * 0.5)) * 1.0;
                }
                
                float finalAlpha = (alpha + glow) * vBrightness * lensingBrightness;
                
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
            type: gl.getAttribLocation(this.program, 'aType'),
        };

        // Get uniform locations
        this.uniforms = {
            resolution: gl.getUniformLocation(this.program, 'uResolution'),
            time: gl.getUniformLocation(this.program, 'uTime'),
            globalPulse: gl.getUniformLocation(this.program, 'uGlobalPulse'),
            blackHolePos: gl.getUniformLocation(this.program, 'uBlackHolePos'),
            eventHorizonRadius: gl.getUniformLocation(this.program, 'uEventHorizonRadius'),
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
            type: gl.createBuffer(),
        };
    }

    allocateParticles(count) {
        this.maxParticles = count;
        this.particleCount = 0;

        this.positionData = new Float32Array(count * 2);
        this.sizeData = new Float32Array(count);
        this.colorData = new Float32Array(count * 3);
        this.twinkleData = new Float32Array(count * 2);
        this.brightnessData = new Float32Array(count * 2);
        this.typeData = new Float32Array(count);
    }

    uploadParticles(particles) {
        const gl = this.gl;
        if (!gl) return;

        const count = Math.min(particles.length, this.maxParticles);
        this.particleCount = count;

        for (let i = 0; i < count; i++) {
            const p = particles[i];
            const i2 = i * 2;
            const i3 = i * 3;

            this.positionData[i2] = p.x;
            this.positionData[i2 + 1] = p.y;

            this.sizeData[i] = p.size;

            // Color parsing
            let r, g, b;
            if (typeof p.color === 'string' && p.color.startsWith('#')) {
                r = parseInt(p.color.slice(1, 3), 16) / 255;
                g = parseInt(p.color.slice(3, 5), 16) / 255;
                b = parseInt(p.color.slice(5, 7), 16) / 255;
            } else if (p.color && p.color.startsWith('rgba')) {
                const parts = p.color.match(/[\d.]+/g);
                if (parts && parts.length >= 3) {
                    r = parseFloat(parts[0]) / 255;
                    g = parseFloat(parts[1]) / 255;
                    b = parseFloat(parts[2]) / 255;
                } else {
                    r = 1.0; g = 1.0; b = 1.0;
                }
            } else {
                r = 0.9; g = 0.9; b = 0.95;
            }

            this.colorData[i3] = r;
            this.colorData[i3 + 1] = g;
            this.colorData[i3 + 2] = b;

            this.twinkleData[i2] = p.twinklePhase || 0;
            this.twinkleData[i2 + 1] = p.twinkleSpeed || 0;

            this.brightnessData[i2] = p.brightness || 1.0;
            this.brightnessData[i2 + 1] = p.pulseBoost || 0;

            this.typeData[i] = p.type || 0; // 0 = star, 1 = galaxy
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

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.bufferData(gl.ARRAY_BUFFER, this.typeData, gl.STATIC_DRAW);
    }

    render(time, globalPulse, blackHolePos, eventHorizonRadius) {
        const gl = this.gl;
        if (!gl || this.particleCount === 0) return;

        gl.useProgram(this.program);

        // Set uniforms
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.uniforms.time, time);
        gl.uniform1f(this.uniforms.globalPulse, globalPulse);

        if (blackHolePos) {
            gl.uniform2f(this.uniforms.blackHolePos, blackHolePos.x, blackHolePos.y);
            gl.uniform1f(this.uniforms.eventHorizonRadius, eventHorizonRadius || 0);
        } else {
            gl.uniform2f(this.uniforms.blackHolePos, -1000, -1000);
            gl.uniform1f(this.uniforms.eventHorizonRadius, 0);
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

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.type);
        gl.enableVertexAttribArray(this.attributes.type);
        gl.vertexAttribPointer(this.attributes.type, 1, gl.FLOAT, false, 0, 0);

        // Clear
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
