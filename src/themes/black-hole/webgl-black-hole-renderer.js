/**
 * WebGL Black Hole Renderer - GPU-accelerated particle system for Black Hole theme
 * 
 * Handles:
 * - Background stars (twinkling)
 * - Accretion disk particles (swirling)
 * - Stardust (sucked into hole)
 * - Eruption particles (spitted out on combos)
 */

export default class WebGLBlackHoleRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.particleProgram = null;
        this.blackHoleProgram = null;
        this.starProgram = null;

        this.buffers = {};
        this.starBuffers = {};
        this.quadBuffer = null;

        this.uniforms = {};
        this.blackHoleUniforms = {};
        this.starUniforms = {};

        this.attributes = {};
        this.starAttributes = {};
        this.blackHoleAttributes = {};

        // Particle data
        this.maxParticles = 0;
        this.particleCount = 0;

        // Typed arrays for GPU upload
        this.positionData = null;      // x, y
        this.sizeData = null;          // size
        this.colorData = null;         // r, g, b
        this.alphaData = null;         // alpha
        this.brightnessData = null;    // brightness boost

        // Star data
        this.starCount = 0;

        // State
        this.blackHolePos = { x: 0, y: 0 };
        this.eventHorizonRadius = 0;
        this.diskIntensity = 1.0;
        this.diskScale = 1.0;
    }

    /**
     * Initialize WebGL context and compile shaders
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
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending for glowing particles

        // Compile shaders
        if (!this.initParticleShaders() || !this.initBlackHoleShaders() || !this.initStarShaders()) {
            return false;
        }

        // Create buffers
        this.initBuffers();

        return true;
    }

    initParticleShaders() {
        const gl = this.gl;

        // Vertex shader
        const vertexShaderSource = `
            precision highp float;
            
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec3 aColor;
            attribute float aAlpha;
            attribute float aBrightness;
            
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec2 uBlackHolePos;
            uniform float uEventHorizonRadius;
            
            varying vec3 vColor;
            varying float vAlpha;
            varying float vSize;
            varying vec2 vPos;
            varying float vDistToHole;
            
            void main() {
                // Convert pixel coords to clip space
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0; // Flip Y
                
                gl_Position = vec4(clipSpace, 0.0, 1.0);
                
                vPos = aPosition;
                
                // Distance to black hole center
                float dist = distance(aPosition, uBlackHolePos);
                vDistToHole = dist;
                
                // Gravitational distortion effect on size
                // Particles get stretched/larger as they get closer to event horizon
                float distortion = 1.0;
                if (dist < uEventHorizonRadius * 4.0) {
                    distortion = 1.0 + (uEventHorizonRadius * 4.0 - dist) / (uEventHorizonRadius * 4.0);
                }
                
                vSize = aSize * distortion;
                gl_PointSize = vSize * 2.0; // Scale up for visibility
                
                // Pass color and alpha
                vColor = aColor * (1.0 + aBrightness); // Apply brightness boost
                vAlpha = aAlpha;
            }
        `;

        // Fragment shader
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 vColor;
            varying float vAlpha;
            varying float vSize;
            varying vec2 vPos;
            varying float vDistToHole;
            
            uniform vec2 uBlackHolePos;
            uniform float uEventHorizonRadius;
            
            void main() {
                // Circular particle
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                
                // Soft edge
                float alpha = 1.0 - smoothstep(0.0, 1.0, dist);
                
                // Event horizon clipping (particles disappear inside)
                if (vDistToHole < uEventHorizonRadius) {
                    alpha *= smoothstep(0.0, 20.0, vDistToHole - (uEventHorizonRadius - 20.0));
                }
                
                // Intense core glow
                float core = exp(-dist * 3.0);
                
                vec3 finalColor = vColor;
                
                gl_FragColor = vec4(finalColor * (alpha + core), vAlpha * alpha);
            }
        `;

        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

        if (!vertexShader || !fragmentShader) return false;

        this.particleProgram = gl.createProgram();
        gl.attachShader(this.particleProgram, vertexShader);
        gl.attachShader(this.particleProgram, fragmentShader);
        gl.linkProgram(this.particleProgram);

        if (!gl.getProgramParameter(this.particleProgram, gl.LINK_STATUS)) {
            console.error('Particle Program link error:', gl.getProgramInfoLog(this.particleProgram));
            return false;
        }

        // Attributes
        this.attributes = {
            position: gl.getAttribLocation(this.particleProgram, 'aPosition'),
            size: gl.getAttribLocation(this.particleProgram, 'aSize'),
            color: gl.getAttribLocation(this.particleProgram, 'aColor'),
            alpha: gl.getAttribLocation(this.particleProgram, 'aAlpha'),
            brightness: gl.getAttribLocation(this.particleProgram, 'aBrightness'),
        };

        // Uniforms
        this.uniforms = {
            resolution: gl.getUniformLocation(this.particleProgram, 'uResolution'),
            time: gl.getUniformLocation(this.particleProgram, 'uTime'),
            blackHolePos: gl.getUniformLocation(this.particleProgram, 'uBlackHolePos'),
            eventHorizonRadius: gl.getUniformLocation(this.particleProgram, 'uEventHorizonRadius'),
        };

        return true;
    }

    initBlackHoleShaders() {
        const gl = this.gl;

        const vertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                vUv.y = 1.0 - vUv.y; // Flip Y to match canvas
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fragmentShaderSource = `
            precision highp float;
            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec2 uBlackHolePos;
            uniform float uRadius;
            uniform float uDiskIntensity;
            uniform float uDiskScale;
            varying vec2 vUv;

            // Simplex noise function
            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
            float snoise(vec2 v){
                const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
                vec2 i  = floor(v + dot(v, C.yy) );
                vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1;
                i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod(i, 289.0);
                vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                + i.x + vec3(0.0, i1.x, 1.0 ));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m ;
                m = m*m ;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
                vec3 g;
                g.x  = a0.x  * x0.x  + h.x  * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }

            void main() {
                vec2 pixelPos = vUv * uResolution;
                vec2 relPos = pixelPos - uBlackHolePos;
                float dist = length(relPos);
                
                // Event Horizon (Black Void)
                float horizon = smoothstep(uRadius - 2.0, uRadius, dist);
                
                // Accretion Disk
                float angle = atan(relPos.y, relPos.x);
                float spiral = angle * 2.0 + uTime * 0.5;
                float radius = dist / uRadius;
                
                // Noise for accretion disk structure
                float noiseVal = snoise(vec2(radius * 5.0 - uTime * 2.0, angle * 3.0));
                float noiseVal2 = snoise(vec2(radius * 10.0 + uTime, angle * 5.0));
                
                float disk = 0.0;
                if (dist > uRadius * 1.05 && dist < uRadius * 4.0 * uDiskScale) {
                    float ring = smoothstep(uRadius * 1.05, uRadius * 1.5, dist) * (1.0 - smoothstep(uRadius * 2.5 * uDiskScale, uRadius * 4.0 * uDiskScale, dist));
                    disk = ring * (0.5 + 0.5 * noiseVal) * (0.8 + 0.2 * noiseVal2);
                    disk *= 1.0 / (radius * radius * 0.5); // Falloff
                }
                
                // Color mapping for disk
                vec3 diskColor = vec3(1.0, 0.6, 0.2) * disk * uDiskIntensity * 2.0; // Orange/Gold
                diskColor += vec3(0.5, 0.1, 0.8) * disk * 0.5; // Purple tint
                
                // Combine
                vec3 finalColor = diskColor;
                float alpha = disk;
                
                // Inner Mystical Glow (Inside Event Horizon)
                if (dist < uRadius) {
                    float innerDist = dist / uRadius;
                    float innerNoise = snoise(vec2(innerDist * 3.0 + uTime * 0.2, angle * 2.0));
                    float innerGlow = smoothstep(0.0, 1.0, innerDist);
                    
                    // Deep mystical purple/blue core
                    vec3 innerColor = vec3(0.1, 0.0, 0.2) * (0.5 + 0.5 * innerNoise) * innerGlow * 2.0;
                    
                    // Dark center
                    innerColor *= smoothstep(0.2, 0.8, innerDist);
                    
                    finalColor = innerColor;
                    alpha = 1.0;
                }
                
                gl_FragColor = vec4(finalColor, alpha);
            }
        `;

        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        if (!vertexShader || !fragmentShader) return false;

        this.blackHoleProgram = gl.createProgram();
        gl.attachShader(this.blackHoleProgram, vertexShader);
        gl.attachShader(this.blackHoleProgram, fragmentShader);
        gl.linkProgram(this.blackHoleProgram);

        if (!gl.getProgramParameter(this.blackHoleProgram, gl.LINK_STATUS)) {
            console.error('Black Hole Program link error:', gl.getProgramInfoLog(this.blackHoleProgram));
            return false;
        }

        this.blackHoleAttributes = {
            position: gl.getAttribLocation(this.blackHoleProgram, 'aPosition'),
        };

        this.blackHoleUniforms = {
            resolution: gl.getUniformLocation(this.blackHoleProgram, 'uResolution'),
            time: gl.getUniformLocation(this.blackHoleProgram, 'uTime'),
            blackHolePos: gl.getUniformLocation(this.blackHoleProgram, 'uBlackHolePos'),
            radius: gl.getUniformLocation(this.blackHoleProgram, 'uRadius'),
            diskIntensity: gl.getUniformLocation(this.blackHoleProgram, 'uDiskIntensity'),
            diskScale: gl.getUniformLocation(this.blackHoleProgram, 'uDiskScale'),
        };

        return true;
    }

    initStarShaders() {
        const gl = this.gl;

        const vertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            attribute float aSize;
            attribute vec3 aColor;
            attribute float aTwinklePhase;
            attribute float aTwinkleSpeed;
            
            uniform vec2 uResolution;
            uniform float uTime;
            
            varying vec3 vColor;
            varying float vAlpha;
            
            void main() {
                vec2 clipSpace = (aPosition / uResolution) * 2.0 - 1.0;
                clipSpace.y *= -1.0;
                gl_Position = vec4(clipSpace, 0.9, 1.0); // High Z to be behind everything
                
                float twinkle = 0.5 + 0.5 * sin(uTime * aTwinkleSpeed * 10.0 + aTwinklePhase);
                vAlpha = 0.5 + 0.5 * twinkle;
                vColor = aColor;
                
                gl_PointSize = aSize;
            }
        `;

        const fragmentShaderSource = `
            precision highp float;
            varying vec3 vColor;
            varying float vAlpha;
            
            void main() {
                vec2 center = gl_PointCoord - vec2(0.5);
                float dist = length(center) * 2.0;
                if (dist > 1.0) discard;
                
                float alpha = 1.0 - smoothstep(0.5, 1.0, dist);
                gl_FragColor = vec4(vColor, vAlpha * alpha);
            }
        `;

        const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexShaderSource);
        const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        if (!vertexShader || !fragmentShader) return false;

        this.starProgram = gl.createProgram();
        gl.attachShader(this.starProgram, vertexShader);
        gl.attachShader(this.starProgram, fragmentShader);
        gl.linkProgram(this.starProgram);

        if (!gl.getProgramParameter(this.starProgram, gl.LINK_STATUS)) {
            console.error('Star Program link error:', gl.getProgramInfoLog(this.starProgram));
            return false;
        }

        this.starAttributes = {
            position: gl.getAttribLocation(this.starProgram, 'aPosition'),
            size: gl.getAttribLocation(this.starProgram, 'aSize'),
            color: gl.getAttribLocation(this.starProgram, 'aColor'),
            twinklePhase: gl.getAttribLocation(this.starProgram, 'aTwinklePhase'),
            twinkleSpeed: gl.getAttribLocation(this.starProgram, 'aTwinkleSpeed'),
        };

        this.starUniforms = {
            resolution: gl.getUniformLocation(this.starProgram, 'uResolution'),
            time: gl.getUniformLocation(this.starProgram, 'uTime'),
        };

        return true;
    }

    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            return null;
        }
        return shader;
    }

    initBuffers() {
        const gl = this.gl;

        // Particle buffers
        this.buffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
            alpha: gl.createBuffer(),
            brightness: gl.createBuffer(),
        };

        // Star buffers
        this.starBuffers = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            color: gl.createBuffer(),
            twinklePhase: gl.createBuffer(),
            twinkleSpeed: gl.createBuffer(),
        };

        // Quad buffer for Black Hole
        this.quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            -1, 1,
            1, -1,
            1, 1,
        ]), gl.STATIC_DRAW);
    }

    allocateParticles(count) {
        this.maxParticles = count;
        this.particleCount = 0;

        this.positionData = new Float32Array(count * 2);
        this.sizeData = new Float32Array(count);
        this.colorData = new Float32Array(count * 3);
        this.alphaData = new Float32Array(count);
        this.brightnessData = new Float32Array(count);
    }

    setStars(stars) {
        const gl = this.gl;
        if (!gl) return;

        this.starCount = stars.length;
        const posData = new Float32Array(this.starCount * 2);
        const sizeData = new Float32Array(this.starCount);
        const colorData = new Float32Array(this.starCount * 3);
        const phaseData = new Float32Array(this.starCount);
        const speedData = new Float32Array(this.starCount);

        for (let i = 0; i < this.starCount; i++) {
            const s = stars[i];
            posData[i * 2] = s.x;
            posData[i * 2 + 1] = s.y;
            sizeData[i] = s.size;

            // Parse color string (e.g., "rgba(255, 255, 255, 1)")
            // Simple parsing assuming standard format
            const colorMatch = s.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (colorMatch) {
                colorData[i * 3] = parseInt(colorMatch[1]) / 255;
                colorData[i * 3 + 1] = parseInt(colorMatch[2]) / 255;
                colorData[i * 3 + 2] = parseInt(colorMatch[3]) / 255;
            } else {
                colorData[i * 3] = 1;
                colorData[i * 3 + 1] = 1;
                colorData[i * 3 + 2] = 1;
            }

            phaseData[i] = s.twinklePhase;
            speedData[i] = s.twinkleSpeed;
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, sizeData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.twinklePhase);
        gl.bufferData(gl.ARRAY_BUFFER, phaseData, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.twinkleSpeed);
        gl.bufferData(gl.ARRAY_BUFFER, speedData, gl.STATIC_DRAW);
    }

    /**
     * Update particle data from JS simulation
     * Optimized to accept TypedArrays directly
     */
    updateParticles(count, posData, sizeData, colorData, alphaData, brightnessData) {
        const gl = this.gl;
        if (!gl) return;

        this.particleCount = Math.min(count, this.maxParticles);

        // Upload to GPU (DYNAMIC_DRAW because we update every frame)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
        gl.bufferData(gl.ARRAY_BUFFER, posData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
        gl.bufferData(gl.ARRAY_BUFFER, sizeData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
        gl.bufferData(gl.ARRAY_BUFFER, colorData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.alpha);
        gl.bufferData(gl.ARRAY_BUFFER, alphaData, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
        gl.bufferData(gl.ARRAY_BUFFER, brightnessData, gl.DYNAMIC_DRAW);
    }

    render(time) {
        const gl = this.gl;
        if (!gl) return;

        // Clear
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // 1. Render Stars (Background)
        if (this.starCount > 0) {
            gl.useProgram(this.starProgram);
            gl.uniform2f(this.starUniforms.resolution, this.canvas.width, this.canvas.height);
            gl.uniform1f(this.starUniforms.time, time);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.position);
            gl.enableVertexAttribArray(this.starAttributes.position);
            gl.vertexAttribPointer(this.starAttributes.position, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.size);
            gl.enableVertexAttribArray(this.starAttributes.size);
            gl.vertexAttribPointer(this.starAttributes.size, 1, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.color);
            gl.enableVertexAttribArray(this.starAttributes.color);
            gl.vertexAttribPointer(this.starAttributes.color, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.twinklePhase);
            gl.enableVertexAttribArray(this.starAttributes.twinklePhase);
            gl.vertexAttribPointer(this.starAttributes.twinklePhase, 1, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffers.twinkleSpeed);
            gl.enableVertexAttribArray(this.starAttributes.twinkleSpeed);
            gl.vertexAttribPointer(this.starAttributes.twinkleSpeed, 1, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, this.starCount);
        }

        // 2. Render Black Hole (Middle)
        gl.useProgram(this.blackHoleProgram);
        gl.uniform2f(this.blackHoleUniforms.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.blackHoleUniforms.time, time);
        gl.uniform2f(this.blackHoleUniforms.blackHolePos, this.blackHolePos.x, this.blackHolePos.y);
        gl.uniform1f(this.blackHoleUniforms.radius, this.eventHorizonRadius);
        gl.uniform1f(this.blackHoleUniforms.diskIntensity, this.diskIntensity);
        gl.uniform1f(this.blackHoleUniforms.diskScale, this.diskScale);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.blackHoleAttributes.position);
        gl.vertexAttribPointer(this.blackHoleAttributes.position, 2, gl.FLOAT, false, 0, 0);

        // Use additive blending for the disk glow, but we might want normal blending for the black void?
        // The shader outputs alpha=1 for the void, so with SRC_ALPHA/ONE, it will add black (0,0,0) which does nothing.
        // We want the void to occlude stars.
        // Change blend func for black hole:
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // Restore additive blending for particles
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        // 3. Render Particles (Foreground)
        if (this.particleCount > 0) {
            gl.useProgram(this.particleProgram);
            gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
            gl.uniform1f(this.uniforms.time, time);
            gl.uniform2f(this.uniforms.blackHolePos, this.blackHolePos.x, this.blackHolePos.y);
            gl.uniform1f(this.uniforms.eventHorizonRadius, this.eventHorizonRadius);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
            gl.enableVertexAttribArray(this.attributes.position);
            gl.vertexAttribPointer(this.attributes.position, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
            gl.enableVertexAttribArray(this.attributes.size);
            gl.vertexAttribPointer(this.attributes.size, 1, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
            gl.enableVertexAttribArray(this.attributes.color);
            gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.alpha);
            gl.enableVertexAttribArray(this.attributes.alpha);
            gl.vertexAttribPointer(this.attributes.alpha, 1, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.brightness);
            gl.enableVertexAttribArray(this.attributes.brightness);
            gl.vertexAttribPointer(this.attributes.brightness, 1, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, this.particleCount);
        }
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    setBlackHoleParams(x, y, radius, diskIntensity = 1.0, diskScale = 1.0) {
        this.blackHolePos = { x, y };
        this.eventHorizonRadius = radius;
        this.diskIntensity = diskIntensity;
        this.diskScale = diskScale;
    }
}
