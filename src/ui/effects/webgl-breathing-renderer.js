/**
 * WebGL Breathing Renderer - GPU-accelerated visuals for breathing techniques
 *
 * ENHANCED VERSION - Each technique now has unique, stunning visuals:
 * - Aurora Dreams: Dancing curtains with stars and mountains
 * - Volcanic Fire: Lava lake with magma and intense embers
 * - Ocean Tide: Wave crests with underwater caustics
 * - Electric Storm: Forked lightning with rolling clouds
 * - Cosmic Nebula: Spiral galaxy with star birth
 * - Heart Glow: Stylized heart with radiating love waves
 * - Moonlit Waters: Luminous moon with water reflections
 * - Sacred Geometry: Metatron's Cube with golden spirals
 * - Crystal Prism: Rainbow refraction with sparkles
 * - Ancient Forest: Tree silhouettes with fireflies
 * - Zen Garden: Cherry blossoms with koi fish
 * - Solar Flare: Corona with prominences
 */

export class WebGLBreathingRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.programs = {};
        this.buffers = {};
        this.currentTechnique = 'deep-relaxation';
        this.techniqueParams = {};

        // State
        this.startTime = Date.now();
        this.intensity = 0.0;
        this.phase = 'inhale'; // inhale, hold, exhale

        // Particles
        this.particleCount = 200;
        this.particlesData = null;
    }

    init() {
        if (this.gl) return true;

        const gl = this.canvas.getContext('webgl2', {
            alpha: true,
            antialias: true,
            premultipliedAlpha: false
        });

        if (!gl) {
            console.warn('WebGL2 not supported, falling back to WebGL1');
            this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        } else {
            this.gl = gl;
        }

        if (!this.gl) {
            console.error('WebGL not supported');
            return false;
        }

        // Enable blending
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

        // Initialize programs
        this.initFlowProgram();
        this.initGeometryProgram();
        this.initParticleProgram();

        // Common quad buffer
        this.initQuadBuffer();

        // Particle buffer
        this.initParticleBuffers();

        return true;
    }

    resize(width, height) {
        if (this.gl) {
            this.canvas.width = width;
            this.canvas.height = height;
            this.gl.viewport(0, 0, width, height);
        }
    }

    setTechnique(technique, params) {
        this.currentTechnique = technique;
        this.techniqueParams = params;
    }

    updateIntensity(intensity, phase) {
        this.intensity = intensity;
        this.phase = phase;
    }

    render() {
        if (!this.gl) return;

        const time = (Date.now() - this.startTime) / 1000;

        this.gl.clearColor(0, 0, 0, 0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);

        // Select renderer based on technique
        switch (this.currentTechnique) {
            case 'box-breathing': // Sacred Geometry
            case 'triangle':      // Crystal Prism
            case 'zen-garden':    // Zen Garden (Geometry + Ripples)
                this.renderGeometry(time);
                break;

            case 'deep-relaxation': // Aurora
            case 'calm-sleep':      // Moonlit Water
            case 'ocean-breath':    // Ocean
            case 'wim-hof':         // Volcanic Fire
            case 'energizing':      // Solar Flare
            case 'cosmic-breath':   // Nebula
            case 'electric-storm':  // Storm
            case 'forest-breath':   // Forest
            case 'coherence':       // Heart
            default:
                this.renderFlow(time);
                break;
        }

        // Always render particles on top
        this.renderParticles(time);
    }

    // --- Enhanced Flow Shader ---

    initFlowProgram() {
        const vs = `#version 300 es
            in vec2 aPosition;
            out vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fs = `#version 300 es
            precision highp float;

            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;
            uniform float uIntensity;
            uniform float uSpeed;
            uniform float uScale;
            uniform int uMode;

            in vec2 vUv;
            out vec4 fragColor;

            #define PI 3.14159265359
            #define TAU 6.28318530718

            // ============ NOISE FUNCTIONS ============

            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
            vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

            float snoise(vec2 v) {
                const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
                vec2 i = floor(v + dot(v, C.yy));
                vec2 x0 = v - i + dot(i, C.xx);
                vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
                vec4 x12 = x0.xyxy + C.xxzz;
                x12.xy -= i1;
                i = mod(i, 289.0);
                vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
                vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
                m = m*m; m = m*m;
                vec3 x = 2.0 * fract(p * C.www) - 1.0;
                vec3 h = abs(x) - 0.5;
                vec3 ox = floor(x + 0.5);
                vec3 a0 = x - ox;
                m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
                vec3 g;
                g.x = a0.x * x0.x + h.x * x0.y;
                g.yz = a0.yz * x12.xz + h.yz * x12.yw;
                return 130.0 * dot(m, g);
            }

            float fbm(vec2 p) {
                float total = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < 5; i++) {
                    total += snoise(p) * amplitude;
                    p *= 2.0;
                    amplitude *= 0.5;
                }
                return total;
            }

            float fbm3(vec2 p) {
                float total = 0.0;
                float amplitude = 0.5;
                for (int i = 0; i < 3; i++) {
                    total += snoise(p) * amplitude;
                    p *= 2.0;
                    amplitude *= 0.5;
                }
                return total;
            }

            float domainWarp(vec2 p, float time) {
                vec2 q = vec2(fbm3(p), fbm3(p + vec2(5.2, 1.3)));
                vec2 r = vec2(fbm3(p + 4.0*q + vec2(1.7, 9.2) + 0.15*time),
                              fbm3(p + 4.0*q + vec2(8.3, 2.8) + 0.126*time));
                return fbm3(p + 4.0*r);
            }

            // Hash function for procedural randomness
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float hash21(vec2 p) {
                p = fract(p * vec2(234.34, 435.345));
                p += dot(p, p + 34.23);
                return fract(p.x * p.y);
            }

            // Rotation matrix
            mat2 rot(float a) {
                float s = sin(a), c = cos(a);
                return mat2(c, -s, s, c);
            }

            // ============ SDF SHAPES ============

            float sdCircle(vec2 p, float r) {
                return length(p) - r;
            }

            float sdHeart(vec2 p) {
                p.x = abs(p.x);
                if (p.y + p.x > 1.0)
                    return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
                return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)),
                               dot(p - 0.5 * max(p.x + p.y, 0.0), p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
            }

            float sdMoon(vec2 p, float d, float ra, float rb) {
                p.y = abs(p.y);
                float a = (ra*ra - rb*rb + d*d)/(2.0*d);
                float b = sqrt(max(ra*ra-a*a,0.0));
                if (d*(p.x*b-p.y*a) > d*d*max(b-p.y,0.0))
                    return length(p-vec2(a,b));
                return max((length(p)-ra), -(length(p-vec2(d,0.0))-rb));
            }

            // ============ STARS ============

            float getStars(vec2 uv, float t) {
                vec2 id = floor(uv * 20.0);
                vec2 gv = fract(uv * 20.0) - 0.5;
                float n = hash(id);
                float size = n * 0.4;
                float twinkle = 0.5 + 0.5 * sin(t * (1.0 + n * 3.0) + n * 10.0);
                float star = smoothstep(size, 0.0, length(gv)) * twinkle;
                return star * step(0.8, n);
            }

            float getStarsLayered(vec2 uv, float t) {
                float stars = 0.0;
                stars += getStars(uv * 1.0, t) * 0.5;
                stars += getStars(uv * 2.0 + 100.0, t * 1.1) * 0.3;
                stars += getStars(uv * 4.0 + 200.0, t * 0.9) * 0.2;
                return stars;
            }

            // ============ LIGHTNING ============

            float lightning(vec2 uv, float t, float seed) {
                float bolt = 0.0;
                vec2 p = uv;
                float amplitude = 0.3;

                for (int i = 0; i < 8; i++) {
                    float offset = snoise(vec2(float(i) * 10.0 + seed, t * 5.0)) * amplitude;
                    p.x += offset;
                    amplitude *= 0.7;
                }

                float width = 0.02 * (1.0 - uv.y * 0.5);
                bolt = smoothstep(width, 0.0, abs(p.x));
                bolt *= smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.5, uv.y);

                return bolt;
            }

            // ============ MAIN TECHNIQUES ============

            void main() {
                vec2 uv = vUv;
                float aspect = uResolution.x / uResolution.y;
                uv.x *= aspect;

                float time = uTime * uSpeed;
                vec3 color = vec3(0.0);
                float alpha = 0.0;

                vec2 center = vec2(0.5 * aspect, 0.5);
                float distFromCenter = length(uv - center);

                // ========== MODE 0: AURORA DREAMS ==========
                if (uMode == 0) {
                    // Starfield background
                    float stars = getStarsLayered(uv, time);
                    color += vec3(0.8, 0.9, 1.0) * stars;

                    // Dancing aurora curtains
                    float curtainY = uv.y;
                    vec2 p = uv * uScale;

                    // Multiple curtain layers
                    for (int i = 0; i < 3; i++) {
                        float fi = float(i);
                        float layerSpeed = 0.1 + fi * 0.05;
                        float layerOffset = fi * 100.0;

                        // Vertical wave motion
                        float wave = sin(p.x * (2.0 + fi) + time * layerSpeed + fi) * 0.3;
                        float curtain = fbm3(vec2(p.x * 0.5 + layerOffset, curtainY * 0.2 + wave - time * 0.1));

                        // Vertical bands
                        float bands = sin(uv.y * 15.0 + curtain * 8.0 + time * 0.5) * 0.5 + 0.5;
                        bands *= smoothstep(0.2, 0.6, curtainY) * smoothstep(0.95, 0.7, curtainY);

                        // Shimmer effect
                        float shimmer = sin(uv.y * 80.0 + time * 8.0 + fi * 2.0) * 0.15 + 0.85;

                        // Color gradient through curtain
                        vec3 curtainColor = mix(uColor1, uColor2, curtain);
                        curtainColor = mix(curtainColor, uColor3, bands * 0.5);

                        float curtainAlpha = smoothstep(0.1, 0.5, curtain) * bands * shimmer * (0.4 - fi * 0.1);
                        color += curtainColor * curtainAlpha;
                        alpha = max(alpha, curtainAlpha);
                    }

                    // Mountain silhouette at bottom
                    float mountainHeight = 0.15 + fbm3(vec2(uv.x * 3.0, 0.0)) * 0.08;
                    float mountain = smoothstep(mountainHeight + 0.01, mountainHeight - 0.01, uv.y);
                    color = mix(color, vec3(0.02, 0.03, 0.05), mountain);

                    alpha = max(alpha, 0.3);
                }

                // ========== MODE 1: OCEAN TIDE ==========
                else if (uMode == 1) {
                    vec2 p = uv * uScale;

                    // Deep underwater gradient
                    vec3 deepColor = uColor3 * 0.3;
                    vec3 shallowColor = uColor1;
                    color = mix(deepColor, shallowColor, uv.y);

                    // Caustic light patterns
                    float caustic1 = sin(p.x * 8.0 + time * 2.0) * sin(p.y * 6.0 - time * 1.5);
                    float caustic2 = sin(p.x * 5.0 - time * 1.8 + 1.0) * sin(p.y * 7.0 + time * 2.2);
                    float caustics = (caustic1 + caustic2) * 0.25 + 0.5;
                    caustics = pow(caustics, 2.0);
                    color += vec3(0.2, 0.4, 0.5) * caustics * 0.5;

                    // Wave surface at top
                    float waveHeight = 0.75 + sin(uv.x * 8.0 + time * 2.0) * 0.05
                                          + sin(uv.x * 12.0 - time * 3.0) * 0.03;
                    float wave = smoothstep(waveHeight - 0.02, waveHeight + 0.02, uv.y);

                    // Foam on wave crests
                    float foam = smoothstep(waveHeight, waveHeight + 0.04, uv.y);
                    foam *= smoothstep(waveHeight + 0.08, waveHeight + 0.02, uv.y);
                    foam *= (sin(uv.x * 50.0 + time * 5.0) * 0.5 + 0.5) * 0.5 + 0.5;
                    color += vec3(1.0) * foam * 0.6;

                    // Light rays from surface
                    float rays = 0.0;
                    for (int i = 0; i < 5; i++) {
                        float fi = float(i);
                        float rayX = 0.2 + fi * 0.15 + sin(time * 0.5 + fi) * 0.05;
                        float rayDist = abs(uv.x / aspect - rayX);
                        float ray = smoothstep(0.05, 0.0, rayDist) * (1.0 - uv.y) * 0.3;
                        rays += ray;
                    }
                    color += uColor2 * rays;

                    // Bubble particles
                    for (int i = 0; i < 8; i++) {
                        float fi = float(i);
                        vec2 bubblePos = vec2(
                            hash(vec2(fi, 0.0)) * aspect,
                            mod(hash(vec2(fi, 1.0)) + time * (0.05 + hash(vec2(fi, 2.0)) * 0.1), 1.0)
                        );
                        float bubbleSize = 0.005 + hash(vec2(fi, 3.0)) * 0.01;
                        float bubble = smoothstep(bubbleSize, 0.0, length(uv - bubblePos));
                        color += vec3(0.8, 0.9, 1.0) * bubble * 0.5;
                    }

                    alpha = 0.6 + caustics * 0.3;
                }

                // ========== MODE 2: VOLCANIC FIRE ==========
                else if (uMode == 2) {
                    vec2 p = uv * uScale;

                    // Lava lake base
                    float lava = domainWarp(p * 0.8 - vec2(0.0, time * 0.3), time * 0.8);

                    // Magma cracks
                    float cracks = 1.0 - abs(snoise(p * 3.0 + time * 0.2));
                    cracks = pow(cracks, 8.0);

                    // Radial heat gradient
                    float heat = 1.0 - smoothstep(0.0, 0.5, distFromCenter);
                    heat = pow(heat, 0.7);

                    // Base lava color
                    color = mix(uColor3, uColor1, lava); // Dark red to orange
                    color = mix(color, uColor2, cracks * heat); // Bright yellow cracks

                    // Hot spots (bubbling magma)
                    for (int i = 0; i < 6; i++) {
                        float fi = float(i);
                        vec2 spotPos = center + vec2(
                            sin(time * 0.5 + fi * 2.0) * 0.15,
                            cos(time * 0.4 + fi * 2.5) * 0.15
                        );
                        float spot = smoothstep(0.08, 0.0, length(uv - spotPos));
                        float pulse = sin(time * 3.0 + fi * 1.5) * 0.5 + 0.5;
                        color += vec3(1.0, 0.9, 0.5) * spot * pulse;
                    }

                    // Rising embers
                    for (int i = 0; i < 15; i++) {
                        float fi = float(i);
                        float emberY = mod(hash(vec2(fi, 0.0)) + time * (0.2 + hash(vec2(fi, 1.0)) * 0.3), 1.2) - 0.1;
                        float emberX = hash(vec2(fi, 2.0)) * aspect + sin(time * 2.0 + fi) * 0.05;
                        float emberSize = 0.008 + hash(vec2(fi, 3.0)) * 0.008;
                        float ember = smoothstep(emberSize, 0.0, length(uv - vec2(emberX, emberY)));
                        float emberBright = 1.0 - emberY * 0.5;
                        color += vec3(1.0, 0.6, 0.2) * ember * emberBright;
                    }

                    // Heat distortion overlay
                    float distortion = fbm3(p * 2.0 - vec2(0.0, time * 2.0)) * 0.1;

                    // Smoke at top
                    float smoke = fbm3(vec2(uv.x * 3.0, (uv.y - 0.7) * 2.0 - time * 0.5));
                    smoke *= smoothstep(0.6, 0.9, uv.y);
                    color = mix(color, vec3(0.15, 0.1, 0.08), smoke * 0.6);

                    // Core glow
                    color += vec3(1.0, 0.5, 0.2) * heat * 0.4;

                    alpha = heat * 1.2 + lava * 0.3;
                }

                // ========== MODE 3: COSMIC NEBULA ==========
                else if (uMode == 3) {
                    vec2 p = uv * uScale;

                    // Spiral galaxy structure
                    float angle = atan(uv.y - center.y, uv.x - center.x);
                    float radius = length(uv - center);

                    // Spiral arms
                    float spiralArm = sin(angle * 2.0 - radius * 8.0 + time * 0.3);
                    spiralArm = spiralArm * 0.5 + 0.5;
                    spiralArm *= smoothstep(0.5, 0.1, radius);

                    // Nebula clouds
                    vec2 warpedP = p + vec2(cos(angle + radius * 3.0), sin(angle + radius * 3.0)) * 0.2;
                    float clouds = domainWarp(warpedP * 0.5, time * 0.15);

                    // Color the nebula
                    color = mix(uColor1, uColor2, clouds);
                    color = mix(color, uColor3, spiralArm * 0.6);

                    // Dark dust lanes
                    float dust = fbm3(p * 2.0 + time * 0.05);
                    dust = smoothstep(0.3, 0.7, dust);
                    color *= 0.5 + 0.5 * dust;

                    // Star field
                    float stars = getStarsLayered(uv * 2.0, time);
                    color += vec3(1.0) * stars;

                    // Bright core
                    float core = smoothstep(0.15, 0.0, radius);
                    color += vec3(1.0, 0.95, 0.9) * core * 0.5;

                    // Star birth (bright points)
                    for (int i = 0; i < 5; i++) {
                        float fi = float(i);
                        float birthAngle = fi * 1.2 + time * 0.2;
                        float birthRadius = 0.1 + fi * 0.06;
                        vec2 birthPos = center + vec2(cos(birthAngle), sin(birthAngle)) * birthRadius;
                        float birth = smoothstep(0.02, 0.0, length(uv - birthPos));
                        float pulse = sin(time * 4.0 + fi * 2.0) * 0.3 + 0.7;
                        color += uColor2 * birth * pulse;
                    }

                    // Shooting star (occasional)
                    float shootingPhase = mod(time, 8.0);
                    if (shootingPhase < 0.5) {
                        vec2 shootStart = vec2(0.8 * aspect, 0.9);
                        vec2 shootEnd = vec2(0.2 * aspect, 0.4);
                        vec2 shootPos = mix(shootStart, shootEnd, shootingPhase * 2.0);
                        float shootTrail = 0.0;
                        for (int i = 0; i < 10; i++) {
                            vec2 trailPos = mix(shootStart, shootEnd, shootingPhase * 2.0 - float(i) * 0.02);
                            float trail = smoothstep(0.02, 0.0, length(uv - trailPos)) * (1.0 - float(i) * 0.1);
                            shootTrail += trail;
                        }
                        color += vec3(1.0, 0.9, 0.8) * shootTrail;
                    }

                    alpha = 0.4 + clouds * 0.5 + spiralArm * 0.3;
                }

                // ========== MODE 4: ANCIENT FOREST ==========
                else if (uMode == 4) {
                    vec2 p = uv * uScale;

                    // Forest floor organic pattern
                    float organic = fbm(p + fbm3(p * 2.0));
                    color = mix(uColor1, uColor2, organic);

                    // God rays from above
                    float rays = 0.0;
                    for (int i = 0; i < 7; i++) {
                        float fi = float(i);
                        float rayAngle = -0.3 + fi * 0.1 + sin(time * 0.2 + fi) * 0.05;
                        vec2 rayDir = vec2(sin(rayAngle), cos(rayAngle));
                        float rayX = 0.1 + fi * 0.12;
                        vec2 rayStart = vec2(rayX * aspect, 1.0);
                        vec2 toPoint = uv - rayStart;
                        float rayDist = abs(toPoint.x * rayDir.y - toPoint.y * rayDir.x);
                        float ray = smoothstep(0.03, 0.0, rayDist);
                        ray *= smoothstep(1.0, 0.3, uv.y);
                        ray *= (sin(time * 0.5 + fi * 0.8) * 0.3 + 0.7);
                        rays += ray * 0.15;
                    }
                    color += uColor3 * rays;

                    // Fireflies
                    for (int i = 0; i < 12; i++) {
                        float fi = float(i);
                        float flyTime = time * (0.3 + hash(vec2(fi, 0.0)) * 0.4);
                        vec2 flyPos = vec2(
                            hash(vec2(fi, 1.0)) * aspect + sin(flyTime + fi) * 0.1,
                            hash(vec2(fi, 2.0)) * 0.6 + 0.2 + cos(flyTime * 1.3 + fi) * 0.05
                        );
                        float flySize = 0.008 + hash(vec2(fi, 3.0)) * 0.006;
                        float fly = smoothstep(flySize, 0.0, length(uv - flyPos));
                        float glow = sin(time * 3.0 + fi * 2.0) * 0.5 + 0.5;
                        glow = pow(glow, 2.0);
                        color += vec3(0.8, 1.0, 0.4) * fly * glow;
                    }

                    // Tree silhouettes on edges
                    float treeLeft = 0.0;
                    for (int i = 0; i < 3; i++) {
                        float fi = float(i);
                        float treeX = 0.05 + fi * 0.08;
                        float treeWidth = 0.02 + fbm3(vec2(uv.y * 2.0 + fi, 0.0)) * 0.03;
                        float trunk = smoothstep(treeX + treeWidth, treeX, uv.x / aspect);
                        trunk *= smoothstep(0.3, 0.8, uv.y);
                        // Canopy
                        float canopyY = 0.7 + fi * 0.1;
                        float canopy = smoothstep(0.15, 0.0, length(vec2(uv.x / aspect - treeX, uv.y - canopyY)));
                        treeLeft = max(treeLeft, max(trunk, canopy) * (0.6 - fi * 0.15));
                    }
                    color = mix(color, vec3(0.02, 0.03, 0.02), treeLeft);

                    // Floating pollen/spores
                    for (int i = 0; i < 8; i++) {
                        float fi = float(i);
                        float sporeY = mod(hash(vec2(fi, 0.0)) + time * 0.02, 1.0);
                        float sporeX = hash(vec2(fi, 1.0)) * aspect + sin(time * 0.5 + fi * 2.0) * 0.03;
                        float spore = smoothstep(0.004, 0.0, length(uv - vec2(sporeX, sporeY)));
                        color += vec3(0.9, 1.0, 0.8) * spore * 0.4;
                    }

                    // Subtle mist
                    float mist = fbm3(vec2(uv.x * 2.0, uv.y * 0.5 + time * 0.05));
                    mist *= smoothstep(0.4, 0.1, uv.y);
                    color = mix(color, vec3(0.6, 0.7, 0.6), mist * 0.2);

                    alpha = 0.5 + organic * 0.3 + rays * 0.5;
                }

                // ========== MODE 5: ELECTRIC STORM ==========
                else if (uMode == 5) {
                    vec2 p = uv * uScale;

                    // Storm clouds
                    float clouds = fbm(p * 0.8 + time * 0.1);
                    clouds = smoothstep(0.2, 0.8, clouds);

                    // Cloud layers
                    vec3 cloudColor = mix(uColor1 * 0.3, uColor1, clouds);
                    color = cloudColor;

                    // Multiple lightning bolts
                    float lightningTotal = 0.0;
                    for (int i = 0; i < 3; i++) {
                        float fi = float(i);
                        float boltPhase = mod(time * 2.0 + fi * 2.5, 4.0);

                        if (boltPhase < 0.3) {
                            vec2 boltUV = uv;
                            boltUV.x = (boltUV.x - (0.3 + fi * 0.2) * aspect) * 3.0;
                            boltUV.y = 1.0 - boltUV.y;

                            float bolt = lightning(boltUV, time, fi * 100.0);

                            // Branching
                            for (int j = 0; j < 2; j++) {
                                float fj = float(j);
                                float branchY = 0.3 + fj * 0.2;
                                if (boltUV.y > branchY) {
                                    vec2 branchUV = boltUV;
                                    branchUV.x += (boltUV.y - branchY) * (fj == 0.0 ? 0.5 : -0.5);
                                    branchUV.x *= 1.5;
                                    bolt += lightning(branchUV, time, fi * 100.0 + fj * 50.0) * 0.5;
                                }
                            }

                            lightningTotal += bolt * (1.0 - boltPhase * 3.0);
                        }
                    }

                    // Lightning color and glow
                    color += uColor3 * lightningTotal * 3.0;
                    color += uColor2 * pow(lightningTotal, 0.5) * 0.5;

                    // Thunder flash (screen flash)
                    float flashPhase = mod(time * 2.0, 4.0);
                    if (flashPhase < 0.1) {
                        color += vec3(0.3) * (1.0 - flashPhase * 10.0);
                    }

                    // Rain
                    for (int i = 0; i < 30; i++) {
                        float fi = float(i);
                        float rainX = hash(vec2(fi, 0.0)) * aspect;
                        float rainY = mod(hash(vec2(fi, 1.0)) - time * (2.0 + hash(vec2(fi, 2.0))), 1.2) + 0.1;
                        float rainLen = 0.03 + hash(vec2(fi, 3.0)) * 0.02;

                        vec2 rainStart = vec2(rainX, rainY);
                        vec2 rainEnd = vec2(rainX - 0.01, rainY - rainLen);

                        vec2 pa = uv - rainStart;
                        vec2 ba = rainEnd - rainStart;
                        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                        float rainDist = length(pa - ba * h);

                        float rain = smoothstep(0.002, 0.0, rainDist);
                        color += vec3(0.5, 0.6, 0.8) * rain * 0.3;
                    }

                    alpha = 0.5 + clouds * 0.4 + lightningTotal;
                }

                // ========== MODE 6: SOLAR FLARE ==========
                else if (uMode == 6) {
                    vec2 p = uv * uScale;
                    float angle = atan(uv.y - center.y, uv.x - center.x);
                    float radius = length(uv - center);

                    // Sun surface plasma
                    float plasma = domainWarp(p + vec2(cos(angle), sin(angle)) * 0.1, time * 0.8);

                    // Sunspots
                    float sunspots = 0.0;
                    for (int i = 0; i < 4; i++) {
                        float fi = float(i);
                        float spotAngle = fi * 1.5 + time * 0.1;
                        float spotRadius = 0.08 + fi * 0.03;
                        vec2 spotPos = center + vec2(cos(spotAngle), sin(spotAngle)) * spotRadius;
                        float spot = smoothstep(0.04, 0.02, length(uv - spotPos));
                        sunspots += spot * 0.3;
                    }

                    // Solar surface color
                    float heat = 1.0 - smoothstep(0.0, 0.35, radius);
                    heat = pow(heat, 0.6);
                    color = mix(uColor1, uColor2, plasma);
                    color = mix(color, uColor3, heat * 0.5);
                    color *= (1.0 - sunspots);

                    // Corona
                    float corona = smoothstep(0.4, 0.2, radius) * smoothstep(0.15, 0.25, radius);
                    float coronaWave = sin(angle * 12.0 + time * 2.0 + plasma * 5.0) * 0.5 + 0.5;
                    corona *= coronaWave;
                    color += uColor2 * corona * 0.8;

                    // Prominences (solar flares)
                    for (int i = 0; i < 4; i++) {
                        float fi = float(i);
                        float promAngle = fi * 1.57 + time * 0.3 + sin(time + fi) * 0.2;
                        float promHeight = 0.15 + sin(time * 2.0 + fi * 2.0) * 0.05;
                        promHeight *= uIntensity;

                        vec2 promBase = center + vec2(cos(promAngle), sin(promAngle)) * 0.2;
                        vec2 promTip = center + vec2(cos(promAngle), sin(promAngle)) * (0.2 + promHeight);

                        // Arc shape
                        vec2 promMid = (promBase + promTip) * 0.5;
                        promMid += vec2(cos(promAngle + 1.57), sin(promAngle + 1.57)) * promHeight * 0.5;

                        float distToBase = length(uv - promBase);
                        float distToTip = length(uv - promTip);
                        float distToMid = length(uv - promMid);

                        float prom = smoothstep(0.03, 0.0, min(distToBase, min(distToTip, distToMid)));
                        color += vec3(1.0, 0.7, 0.3) * prom;
                    }

                    // Magnetic field lines (subtle)
                    float fieldLines = sin(angle * 8.0 - radius * 20.0 + time) * 0.5 + 0.5;
                    fieldLines *= smoothstep(0.4, 0.2, radius) * smoothstep(0.1, 0.2, radius);
                    color += uColor2 * fieldLines * 0.1;

                    // Solar wind particles
                    for (int i = 0; i < 10; i++) {
                        float fi = float(i);
                        float particleAngle = fi * 0.628 + time * 0.5;
                        float particleRadius = mod(0.25 + time * 0.1 + fi * 0.1, 0.4) + 0.2;
                        vec2 particlePos = center + vec2(cos(particleAngle), sin(particleAngle)) * particleRadius;
                        float particle = smoothstep(0.01, 0.0, length(uv - particlePos));
                        color += vec3(1.0, 0.9, 0.6) * particle * 0.3;
                    }

                    alpha = heat * 1.2 + corona * 0.5;
                }

                // ========== MODE 7: HEART GLOW ==========
                else if (uMode == 7) {
                    vec2 p = (uv - center) * 2.5;
                    p.y -= 0.1;

                    // Heart SDF
                    float heart = sdHeart(p * 1.2);

                    // Pulsing heart
                    float pulse = sin(time * 2.0) * 0.1 * uIntensity;
                    float heartShape = smoothstep(0.05, -0.05, heart + pulse);

                    // Heart color gradient
                    vec3 heartColor = mix(uColor1, uColor2, smoothstep(-0.2, 0.1, heart));

                    // Inner glow
                    float innerGlow = smoothstep(0.0, -0.15, heart);
                    heartColor = mix(heartColor, uColor3, innerGlow * 0.5);

                    color = heartColor * heartShape;

                    // Radiating love waves
                    float waves = 0.0;
                    for (int i = 0; i < 5; i++) {
                        float fi = float(i);
                        float waveRadius = mod(fi * 0.15 + time * 0.3, 0.8);
                        float waveDist = abs(length(uv - center) - waveRadius);
                        float wave = smoothstep(0.02, 0.0, waveDist) * (1.0 - waveRadius);
                        waves += wave * 0.3;
                    }
                    color += uColor2 * waves;

                    // ECG line in background
                    float ecgY = center.y - 0.25;
                    float ecgPhase = mod(uv.x / aspect * 4.0 - time * 2.0, 1.0);
                    float ecgLine = 0.0;
                    if (ecgPhase < 0.1) {
                        ecgLine = 0.0;
                    } else if (ecgPhase < 0.15) {
                        ecgLine = (ecgPhase - 0.1) * 10.0 * 0.15;
                    } else if (ecgPhase < 0.2) {
                        ecgLine = 0.15 - (ecgPhase - 0.15) * 20.0 * 0.15;
                    } else if (ecgPhase < 0.25) {
                        ecgLine = -0.15 + (ecgPhase - 0.2) * 6.0 * 0.15;
                    } else {
                        ecgLine = 0.0;
                    }
                    float ecg = smoothstep(0.01, 0.0, abs(uv.y - ecgY - ecgLine * 0.3));
                    ecg *= smoothstep(0.4, 0.3, abs(uv.y - ecgY));
                    color += uColor2 * ecg * 0.4;

                    // Warm particle aura
                    for (int i = 0; i < 10; i++) {
                        float fi = float(i);
                        float particleAngle = fi * 0.628 + time * 0.5;
                        float particleRadius = 0.2 + sin(time + fi) * 0.05;
                        vec2 particlePos = center + vec2(cos(particleAngle), sin(particleAngle)) * particleRadius;
                        float particle = smoothstep(0.015, 0.0, length(uv - particlePos));
                        color += uColor2 * particle * 0.3;
                    }

                    // Soft glow around heart
                    float glow = smoothstep(0.3, -0.1, heart);
                    color += uColor1 * glow * 0.2;

                    alpha = heartShape + waves * 0.5 + glow * 0.3;
                }

                // ========== MODE 8: MOONLIT WATERS ==========
                else if (uMode == 8) {
                    vec2 p = uv * uScale;

                    // Night sky gradient
                    vec3 skyColor = mix(vec3(0.02, 0.03, 0.08), vec3(0.05, 0.07, 0.15), uv.y);
                    color = skyColor;

                    // Stars in sky
                    if (uv.y > 0.5) {
                        float stars = getStarsLayered(uv * 1.5, time);
                        color += vec3(0.8, 0.85, 1.0) * stars * 0.5;
                    }

                    // Moon
                    vec2 moonPos = vec2(0.7 * aspect, 0.75);
                    float moonRadius = 0.08;
                    float moonDist = length(uv - moonPos);
                    float moon = smoothstep(moonRadius, moonRadius - 0.005, moonDist);

                    // Moon craters (subtle)
                    float craters = fbm3(((uv - moonPos) / moonRadius) * 5.0) * 0.1;
                    vec3 moonColor = uColor2 * (0.95 - craters);
                    color = mix(color, moonColor, moon);

                    // Moon glow
                    float moonGlow = smoothstep(0.2, 0.0, moonDist - moonRadius);
                    color += uColor2 * moonGlow * 0.3;

                    // Water surface (lower half)
                    float waterLine = 0.45;
                    if (uv.y < waterLine) {
                        // Water color
                        vec3 waterColor = mix(uColor3 * 0.3, uColor1 * 0.5, uv.y / waterLine);

                        // Gentle ripples
                        float ripple = sin(uv.x * 30.0 + time * 2.0) * sin(uv.y * 20.0 - time) * 0.02;

                        // Moon reflection
                        vec2 reflectPos = vec2(moonPos.x, waterLine - (moonPos.y - waterLine));
                        reflectPos.y += ripple * 2.0;
                        float reflectDist = length(uv - reflectPos);
                        float reflection = smoothstep(0.12, 0.0, reflectDist);
                        reflection *= (1.0 - (waterLine - uv.y) * 2.0); // Fade with depth

                        // Moonlight path on water
                        float pathWidth = 0.1 + (waterLine - uv.y) * 0.3;
                        float moonPath = smoothstep(pathWidth, 0.0, abs(uv.x - moonPos.x));
                        moonPath *= (1.0 - (waterLine - uv.y) * 1.5);
                        moonPath *= (sin(uv.x * 40.0 + time * 3.0) * 0.3 + 0.7);

                        waterColor += uColor2 * reflection * 0.6;
                        waterColor += uColor2 * moonPath * 0.3;

                        // Star reflections (subtle)
                        float starReflect = getStarsLayered(vec2(uv.x, waterLine - uv.y) * 1.5 + ripple, time);
                        waterColor += vec3(0.5, 0.55, 0.7) * starReflect * 0.1;

                        color = waterColor;
                    }

                    // Gentle mist on water surface
                    float mist = fbm3(vec2(uv.x * 3.0, (uv.y - 0.4) * 10.0 + time * 0.1));
                    mist *= smoothstep(0.35, 0.5, uv.y) * smoothstep(0.55, 0.45, uv.y);
                    color = mix(color, vec3(0.4, 0.45, 0.6), mist * 0.3);

                    alpha = 0.6 + moon * 0.3;
                }

                // Global intensity modulation
                alpha *= (0.3 + 0.7 * uIntensity);

                // Radial vignette
                float vignette = smoothstep(0.5, 0.25, distFromCenter);
                alpha *= vignette;

                // Subtle film grain
                float grain = hash(uv + fract(time)) * 0.03;
                color += grain;

                fragColor = vec4(color, alpha);
            }
        `;

        this.programs.flow = this.createProgram(vs, fs);
        this.buffers.quad = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffers.quad);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), this.gl.STATIC_DRAW);
    }

    renderFlow(time) {
        const gl = this.gl;
        const p = this.programs.flow;
        gl.useProgram(p.program);

        let mode = 0;
        let speed = 0.2;
        let scale = 3.0;

        const colors = this.techniqueParams;
        const c1 = colors.color || { r: 80, g: 200, b: 255 };
        const c2 = colors.secondaryColor || { r: 180, g: 100, b: 255 };
        const c3 = colors.tertiaryColor || { r: 100, g: 255, b: 180 };

        switch (this.currentTechnique) {
            case 'deep-relaxation': // Aurora Dreams
                mode = 0; speed = 0.15; scale = 2.5;
                break;
            case 'ocean-breath': // Ocean Tide
                mode = 1; speed = 0.25; scale = 3.0;
                break;
            case 'wim-hof': // Volcanic Fire
                mode = 2; speed = 0.8; scale = 3.5;
                break;
            case 'cosmic-breath': // Cosmic Nebula
                mode = 3; speed = 0.1; scale = 2.0;
                break;
            case 'forest-breath': // Ancient Forest
                mode = 4; speed = 0.12; scale = 3.0;
                break;
            case 'electric-storm': // Electric Storm
                mode = 5; speed = 1.0; scale = 2.5;
                break;
            case 'energizing': // Solar Flare
                mode = 6; speed = 0.4; scale = 3.0;
                break;
            case 'coherence': // Heart Glow
                mode = 7; speed = 0.15; scale = 1.5;
                break;
            case 'calm-sleep': // Moonlit Waters
                mode = 8; speed = 0.08; scale = 2.0;
                break;
        }

        gl.uniform2f(p.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(p.uniforms.uTime, time);
        gl.uniform3f(p.uniforms.uColor1, c1.r / 255, c1.g / 255, c1.b / 255);
        gl.uniform3f(p.uniforms.uColor2, c2.r / 255, c2.g / 255, c2.b / 255);
        gl.uniform3f(p.uniforms.uColor3, c3.r / 255, c3.g / 255, c3.b / 255);
        gl.uniform1f(p.uniforms.uIntensity, this.intensity);
        gl.uniform1f(p.uniforms.uSpeed, speed);
        gl.uniform1f(p.uniforms.uScale, scale);
        gl.uniform1i(p.uniforms.uMode, mode);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
        gl.enableVertexAttribArray(p.attribs.aPosition);
        gl.vertexAttribPointer(p.attribs.aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // --- Enhanced Geometry Shader ---

    initGeometryProgram() {
        const vs = `#version 300 es
            in vec2 aPosition;
            out vec2 vUv;
            void main() {
                vUv = aPosition * 0.5 + 0.5;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const fs = `#version 300 es
            precision highp float;

            uniform vec2 uResolution;
            uniform float uTime;
            uniform vec3 uColor1;
            uniform vec3 uColor2;
            uniform vec3 uColor3;
            uniform float uIntensity;
            uniform int uShape;

            in vec2 vUv;
            out vec4 fragColor;

            #define PI 3.14159265359
            #define TAU 6.28318530718
            #define PHI 1.61803398875

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            mat2 rot(float a) {
                float s = sin(a), c = cos(a);
                return mat2(c, -s, s, c);
            }

            // SDF Primitives
            float sdCircle(vec2 p, float r) {
                return length(p) - r;
            }

            float sdLine(vec2 p, vec2 a, vec2 b) {
                vec2 pa = p - a, ba = b - a;
                float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                return length(pa - ba * h);
            }

            float sdEquilateralTriangle(vec2 p, float r) {
                const float k = sqrt(3.0);
                p.x = abs(p.x) - r;
                p.y = p.y + r / k;
                if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
                p.x -= clamp(p.x, -2.0 * r, 0.0);
                return -length(p) * sign(p.y);
            }

            float sdHexagon(vec2 p, float r) {
                const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
                p = abs(p);
                p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
                p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
                return length(p) * sign(p.y);
            }

            // Metatron's Cube
            float metatronsCube(vec2 p, float size, float time) {
                float d = 1000.0;

                // Central circle
                d = min(d, abs(sdCircle(p, size * 0.15)) - 0.003);

                // Inner hexagon of circles
                for (int i = 0; i < 6; i++) {
                    float angle = float(i) * PI / 3.0;
                    vec2 offset = vec2(cos(angle), sin(angle)) * size * 0.3;
                    d = min(d, abs(sdCircle(p - offset, size * 0.15)) - 0.003);
                }

                // Outer hexagon of circles
                for (int i = 0; i < 6; i++) {
                    float angle = float(i) * PI / 3.0 + PI / 6.0;
                    vec2 offset = vec2(cos(angle), sin(angle)) * size * 0.52;
                    d = min(d, abs(sdCircle(p - offset, size * 0.15)) - 0.003);
                }

                // Connecting lines (simplified)
                for (int i = 0; i < 6; i++) {
                    float angle1 = float(i) * PI / 3.0;
                    float angle2 = float(i + 1) * PI / 3.0;
                    vec2 p1 = vec2(cos(angle1), sin(angle1)) * size * 0.3;
                    vec2 p2 = vec2(cos(angle2), sin(angle2)) * size * 0.3;
                    d = min(d, sdLine(p, p1, p2) - 0.002);

                    // Lines to center
                    d = min(d, sdLine(p, vec2(0.0), p1) - 0.002);

                    // Lines to outer
                    float outerAngle = float(i) * PI / 3.0 + PI / 6.0;
                    vec2 outer = vec2(cos(outerAngle), sin(outerAngle)) * size * 0.52;
                    d = min(d, sdLine(p, p1, outer) - 0.001);
                    d = min(d, sdLine(p, p2, outer) - 0.001);
                }

                return d;
            }

            // Golden Spiral
            float goldenSpiral(vec2 p, float time) {
                float angle = atan(p.y, p.x);
                float radius = length(p);

                float spiral = log(radius) / log(PHI) - angle / (PI * 0.5);
                spiral = abs(fract(spiral + time * 0.1) - 0.5) * 2.0;
                spiral = smoothstep(0.4, 0.3, spiral) * smoothstep(0.02, 0.05, radius);

                return spiral;
            }

            void main() {
                vec2 uv = vUv * 2.0 - 1.0;
                uv.x *= uResolution.x / uResolution.y;

                float d = 0.0;
                float glow = 0.0;
                vec3 color = vec3(0.0);
                float size = 0.35 + 0.1 * uIntensity;

                // ========== SACRED GEOMETRY (Metatron's Cube) ==========
                if (uShape == 0) {
                    // Multiple rotating layers
                    vec2 p1 = uv * rot(uTime * 0.1);
                    vec2 p2 = uv * rot(-uTime * 0.08);
                    vec2 p3 = uv * rot(uTime * 0.05);

                    float d1 = metatronsCube(p1, size, uTime);
                    float d2 = metatronsCube(p2, size * 0.7, uTime);

                    // Outer boundary circle
                    float d3 = abs(sdCircle(uv, size * 0.7)) - 0.003;

                    d = min(d1, min(d2, d3));

                    // Golden spirals
                    float spiral1 = goldenSpiral(p3, uTime);
                    float spiral2 = goldenSpiral(p3 * rot(PI), uTime);

                    // Glow effect
                    glow = 0.008 / (d + 0.001);
                    glow = min(glow, 2.0);

                    // Color based on geometry
                    color = mix(uColor1, uColor2, length(uv) * 2.0);
                    color += glow * uColor1 * 0.5;
                    color += uColor3 * (spiral1 + spiral2) * 0.3;

                    // Pulsing center
                    float pulse = sin(uTime * 2.0) * 0.5 + 0.5;
                    float centerGlow = smoothstep(0.1, 0.0, length(uv)) * pulse;
                    color += uColor2 * centerGlow;
                }

                // ========== CRYSTAL PRISM (Rainbow Refraction) ==========
                else if (uShape == 1) {
                    vec2 p = uv * rot(sin(uTime * 0.3) * 0.1);

                    // Main prism (triangle)
                    float prism = sdEquilateralTriangle(p + vec2(0.0, 0.05), size * 0.5);

                    // Inverted triangle (Star of David / Merkaba)
                    float prism2 = sdEquilateralTriangle((p + vec2(0.0, -0.05)) * rot(PI), size * 0.5);

                    // Crystal facets
                    float facets = min(prism, prism2);

                    // Rainbow refraction effect
                    float edge = smoothstep(0.03, 0.0, abs(prism));
                    float edge2 = smoothstep(0.03, 0.0, abs(prism2));

                    // Spectral colors based on position
                    vec3 rainbow = vec3(0.0);
                    float hue = atan(p.y, p.x) / TAU + 0.5 + uTime * 0.1;
                    rainbow.r = sin(hue * TAU) * 0.5 + 0.5;
                    rainbow.g = sin((hue + 0.333) * TAU) * 0.5 + 0.5;
                    rainbow.b = sin((hue + 0.666) * TAU) * 0.5 + 0.5;

                    // Light beam entering from top
                    float beam = smoothstep(0.02, 0.0, abs(p.x)) * smoothstep(0.5, 0.2, p.y);
                    beam *= step(0.1, p.y);

                    // Refracted beams exiting
                    for (int i = 0; i < 5; i++) {
                        float fi = float(i);
                        float beamAngle = -0.4 + fi * 0.2;
                        vec2 beamDir = vec2(sin(beamAngle), -cos(beamAngle));
                        vec2 beamStart = vec2(0.0, -0.1);
                        float beamDist = abs(dot(p - beamStart, vec2(beamDir.y, -beamDir.x)));
                        float refractBeam = smoothstep(0.015, 0.0, beamDist);
                        refractBeam *= step(p.y, -0.1) * smoothstep(-0.5, -0.2, p.y);

                        vec3 beamColor = vec3(
                            fi == 0.0 ? 1.0 : (fi == 1.0 ? 1.0 : (fi == 2.0 ? 0.0 : (fi == 3.0 ? 0.0 : 0.5))),
                            fi == 0.0 ? 0.0 : (fi == 1.0 ? 0.5 : (fi == 2.0 ? 1.0 : (fi == 3.0 ? 0.0 : 0.0))),
                            fi == 0.0 ? 0.0 : (fi == 1.0 ? 0.0 : (fi == 2.0 ? 0.0 : (fi == 3.0 ? 1.0 : 1.0)))
                        );
                        color += beamColor * refractBeam * 0.5;
                    }

                    // Crystal body
                    float crystalBody = smoothstep(0.01, -0.02, facets);
                    vec3 crystalColor = mix(uColor1, uColor2, 0.5 + 0.5 * sin(uTime + length(p)));
                    crystalColor += rainbow * edge * 0.5;

                    color += crystalColor * crystalBody * 0.5;
                    color += vec3(1.0) * beam * 0.3;

                    // Edge glow
                    glow = 0.01 / (abs(facets) + 0.002);
                    color += mix(uColor1, uColor2, 0.5) * glow * 0.3;

                    // Sparkles
                    for (int i = 0; i < 8; i++) {
                        float fi = float(i);
                        float sparkleAngle = fi * 0.785 + uTime * 0.5;
                        float sparkleR = 0.2 + sin(uTime * 2.0 + fi) * 0.05;
                        vec2 sparklePos = vec2(cos(sparkleAngle), sin(sparkleAngle)) * sparkleR;
                        float sparkle = smoothstep(0.015, 0.0, length(p - sparklePos));
                        sparkle *= sin(uTime * 5.0 + fi * 2.0) * 0.5 + 0.5;
                        color += vec3(1.0) * sparkle;
                    }

                    glow = crystalBody + edge * 0.5;
                }

                // ========== ZEN GARDEN (Cherry Blossoms & Koi) ==========
                else {
                    // Sand base
                    vec3 sandColor = uColor2 * 0.8;
                    color = sandColor;

                    // Raked sand patterns (concentric circles)
                    float dist = length(uv);
                    float rake = sin(dist * 40.0 - uIntensity * 3.0) * 0.5 + 0.5;
                    rake = pow(rake, 0.5);
                    color = mix(color, uColor2, rake * 0.15);

                    // Ripples expanding from center
                    float ripple = sin(dist * 25.0 - uTime * 2.0) * exp(-dist * 2.0);
                    color += uColor1 * ripple * 0.2;

                    // Stones
                    vec2 stonePositions[3];
                    stonePositions[0] = vec2(0.25, 0.15);
                    stonePositions[1] = vec2(-0.35, -0.1);
                    stonePositions[2] = vec2(0.1, -0.3);

                    for (int i = 0; i < 3; i++) {
                        vec2 stonePos = stonePositions[i];
                        float stoneSize = 0.06 + float(i) * 0.02;
                        float stoneDist = sdCircle(uv - stonePos, stoneSize);

                        if (stoneDist < 0.0) {
                            // Stone color with moss
                            vec3 stoneColor = uColor1 * 0.4;
                            float moss = smoothstep(0.0, -0.03, stoneDist) * (sin(uv.x * 50.0 + uv.y * 30.0) * 0.5 + 0.5);
                            stoneColor = mix(stoneColor, vec3(0.2, 0.3, 0.15), moss * 0.3);
                            color = stoneColor;
                        }

                        // Raked circles around stones
                        float stoneRipple = sin(length(uv - stonePos) * 35.0) * 0.5 + 0.5;
                        stoneRipple *= smoothstep(stoneSize + 0.15, stoneSize + 0.02, length(uv - stonePos));
                        color = mix(color, uColor2, stoneRipple * 0.1);
                    }

                    // Water pond area
                    vec2 pondPos = vec2(-0.15, 0.2);
                    float pondDist = sdCircle(uv - pondPos, 0.15);
                    if (pondDist < 0.0) {
                        vec3 waterColor = uColor1 * 0.6;
                        float waterRipple = sin(length(uv - pondPos) * 30.0 - uTime * 1.5) * 0.1;
                        waterColor += uColor3 * waterRipple;
                        color = waterColor;

                        // Koi fish
                        for (int i = 0; i < 2; i++) {
                            float fi = float(i);
                            float fishAngle = uTime * 0.5 + fi * PI;
                            float fishRadius = 0.08 + fi * 0.02;
                            vec2 fishPos = pondPos + vec2(cos(fishAngle), sin(fishAngle)) * fishRadius;

                            // Fish body (ellipse)
                            vec2 fishLocal = (uv - fishPos) * rot(-fishAngle - PI * 0.5);
                            fishLocal.x *= 2.0;
                            float fishBody = length(fishLocal) - 0.015;

                            if (fishBody < 0.0) {
                                vec3 koiColor = fi == 0.0 ? vec3(1.0, 0.4, 0.1) : vec3(1.0, 1.0, 1.0);
                                // Spots
                                if (sin(fishLocal.x * 30.0 + fi * 10.0) > 0.5) {
                                    koiColor = fi == 0.0 ? vec3(1.0, 1.0, 1.0) : vec3(0.1, 0.1, 0.1);
                                }
                                color = koiColor;
                            }
                        }
                    }

                    // Cherry blossom petals falling
                    for (int i = 0; i < 12; i++) {
                        float fi = float(i);
                        float petalY = mod(hash(vec2(fi, 0.0)) - uTime * 0.05, 1.4) - 0.2;
                        float petalX = hash(vec2(fi, 1.0)) * 2.0 - 1.0;
                        petalX += sin(uTime + fi) * 0.1; // Drift

                        vec2 petalPos = vec2(petalX, petalY);
                        float petalDist = length(uv - petalPos);
                        float petal = smoothstep(0.02, 0.0, petalDist);

                        vec3 petalColor = vec3(1.0, 0.85, 0.9);
                        color = mix(color, petalColor, petal * 0.8);
                    }

                    // Bamboo silhouettes on edges
                    for (int i = 0; i < 2; i++) {
                        float fi = float(i);
                        float bambooX = fi == 0.0 ? -0.85 : 0.9;
                        float bambooDist = abs(uv.x - bambooX);
                        float bamboo = smoothstep(0.02, 0.0, bambooDist);
                        bamboo *= smoothstep(-0.5, 0.8, uv.y);

                        // Bamboo joints
                        float joints = step(0.8, fract(uv.y * 5.0 + fi * 0.3));
                        bamboo *= (1.0 - joints * 0.3);

                        color = mix(color, vec3(0.2, 0.25, 0.15), bamboo * 0.8);
                    }

                    glow = 0.5 + ripple * 0.3;
                }

                // Global intensity modulation
                glow *= (0.3 + 0.7 * uIntensity);

                // Radial mask
                float distFromCenter = length(vUv - 0.5);
                float radialMask = smoothstep(0.5, 0.3, distFromCenter);

                fragColor = vec4(color, glow * uIntensity * radialMask);
            }
        `;

        this.programs.geometry = this.createProgram(vs, fs);
    }

    renderGeometry(time) {
        const gl = this.gl;
        const p = this.programs.geometry;
        gl.useProgram(p.program);

        let shape = 0;
        if (this.currentTechnique === 'triangle') shape = 1;
        if (this.currentTechnique === 'zen-garden') shape = 2;

        const colors = this.techniqueParams;
        const c1 = colors.color || { r: 200, g: 150, b: 255 };
        const c2 = colors.secondaryColor || { r: 255, g: 200, b: 100 };
        const c3 = colors.tertiaryColor || { r: 100, g: 200, b: 255 };

        gl.uniform2f(p.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(p.uniforms.uTime, time);
        gl.uniform3f(p.uniforms.uColor1, c1.r / 255, c1.g / 255, c1.b / 255);
        gl.uniform3f(p.uniforms.uColor2, c2.r / 255, c2.g / 255, c2.b / 255);
        gl.uniform3f(p.uniforms.uColor3, c3.r / 255, c3.g / 255, c3.b / 255);
        gl.uniform1f(p.uniforms.uIntensity, this.intensity);
        gl.uniform1i(p.uniforms.uShape, shape);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad);
        gl.enableVertexAttribArray(p.attribs.aPosition);
        gl.vertexAttribPointer(p.attribs.aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // --- Enhanced Particle Shader ---

    initParticleProgram() {
        const vs = `#version 300 es
            in vec2 aPosition;
            in float aSize;
            in float aSpeed;
            in float aOffset;

            uniform float uTime;
            uniform vec2 uResolution;
            uniform float uIntensity;
            uniform int uMode;

            out float vAlpha;
            out float vMode;

            void main() {
                float t = uTime * aSpeed;
                vec2 pos = aPosition;

                if (uMode == 0) { // Aurora: Slow upward drift with wave
                    pos.y += t * 0.08;
                    pos.y = mod(pos.y + 1.0, 2.0) - 1.0;
                    pos.x += sin(t * 0.5 + aOffset) * 0.08;
                } else if (uMode == 1) { // Ocean: Bubbles rising
                    pos.y += t * 0.15;
                    pos.y = mod(pos.y + 1.0, 2.0) - 1.0;
                    pos.x += sin(t + aOffset) * 0.03;
                } else if (uMode == 2) { // Fire: Fast rising embers
                    pos.y += t * 0.6;
                    pos.y = mod(pos.y + 1.0, 2.2) - 1.1;
                    pos.x += sin(t * 3.0 + aOffset) * 0.15;
                } else if (uMode == 3) { // Nebula: Orbital with expansion
                    float angle = aOffset + t * 0.15;
                    float radius = length(pos) * (1.0 + sin(t * 0.5 + aOffset) * 0.2);
                    pos = vec2(cos(angle), sin(angle)) * radius;
                } else if (uMode == 4) { // Forest: Firefly dance
                    pos.x += sin(t * 0.8 + aOffset) * 0.15;
                    pos.y += cos(t * 0.6 + aOffset * 1.3) * 0.1;
                } else if (uMode == 5) { // Storm: Rain drops
                    pos.y -= t * 1.5;
                    pos.y = mod(pos.y + 1.2, 2.4) - 1.2;
                    pos.x -= t * 0.1;
                } else if (uMode == 6) { // Solar: Radial expansion
                    float angle = aOffset;
                    float radius = mod(t * 0.3 + length(pos), 0.8);
                    pos = vec2(cos(angle), sin(angle)) * radius;
                } else if (uMode == 7) { // Heart: Gentle float around center
                    float angle = aOffset + t * 0.3;
                    float radius = 0.2 + sin(t + aOffset) * 0.05;
                    pos = vec2(cos(angle), sin(angle)) * radius;
                } else { // Moonlit: Gentle float
                    pos.x += sin(t * 0.3 + aOffset) * 0.05;
                    pos.y += cos(t * 0.2 + aOffset) * 0.03;
                }

                pos *= (1.0 + uIntensity * 0.2);
                pos.x *= uResolution.y / uResolution.x;

                gl_Position = vec4(pos, 0.0, 1.0);

                float sizeMultiplier = 1.0;
                if (uMode == 4) sizeMultiplier = 1.5; // Larger fireflies
                if (uMode == 2) sizeMultiplier = 0.8; // Smaller embers

                gl_PointSize = aSize * (1.0 + uIntensity * 0.5) * sizeMultiplier;

                vAlpha = 0.5 + 0.5 * sin(t * 3.0 + aOffset);
                if (uMode == 4) vAlpha = pow(vAlpha, 2.0); // Firefly pulse

                vMode = float(uMode);
            }
        `;

        const fs = `#version 300 es
            precision highp float;

            in float vAlpha;
            in float vMode;
            uniform vec3 uColor;

            out vec4 fragColor;

            void main() {
                vec2 coord = gl_PointCoord - vec2(0.5);
                float dist = length(coord);
                if (dist > 0.5) discard;

                float alpha = (1.0 - dist * 2.0) * vAlpha;

                // Softer glow for certain modes
                if (vMode == 4.0) { // Fireflies - extra glow
                    alpha = pow(1.0 - dist * 2.0, 0.5) * vAlpha;
                }

                fragColor = vec4(uColor, alpha);
            }
        `;

        this.programs.particle = this.createProgram(vs, fs);
    }

    initParticleBuffers() {
        const gl = this.gl;
        const count = this.particleCount;

        const positions = new Float32Array(count * 2);
        const sizes = new Float32Array(count);
        const speeds = new Float32Array(count);
        const offsets = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random()) * 0.9;
            positions[i * 2] = Math.cos(angle) * radius;
            positions[i * 2 + 1] = Math.sin(angle) * radius;

            sizes[i] = 2.0 + Math.random() * 5.0;
            speeds[i] = 0.4 + Math.random() * 1.2;
            offsets[i] = Math.random() * Math.PI * 2;
        }

        this.buffers.particles = {
            position: gl.createBuffer(),
            size: gl.createBuffer(),
            speed: gl.createBuffer(),
            offset: gl.createBuffer(),
            count: count
        };

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.particles.position);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.particles.size);
        gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.particles.speed);
        gl.bufferData(gl.ARRAY_BUFFER, speeds, gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.particles.offset);
        gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
    }

    renderParticles(time) {
        const gl = this.gl;
        const p = this.programs.particle;
        const b = this.buffers.particles;

        if (!p || !b) return;

        gl.useProgram(p.program);

        const colors = this.techniqueParams;
        const c = colors.secondaryColor || { r: 255, g: 255, b: 255 };

        gl.uniform1f(p.uniforms.uTime, time);
        gl.uniform2f(p.uniforms.uResolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(p.uniforms.uIntensity, this.intensity);
        gl.uniform3f(p.uniforms.uColor, c.r / 255, c.g / 255, c.b / 255);

        let mode = 0;
        switch (this.currentTechnique) {
            case 'deep-relaxation': mode = 0; break;
            case 'ocean-breath': mode = 1; break;
            case 'wim-hof': mode = 2; break;
            case 'cosmic-breath': mode = 3; break;
            case 'forest-breath': mode = 4; break;
            case 'electric-storm': mode = 5; break;
            case 'energizing': mode = 6; break;
            case 'coherence': mode = 7; break;
            case 'calm-sleep': mode = 8; break;
        }
        gl.uniform1i(p.uniforms.uMode, mode);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.position);
        gl.enableVertexAttribArray(p.attribs.aPosition);
        gl.vertexAttribPointer(p.attribs.aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.size);
        gl.enableVertexAttribArray(p.attribs.aSize);
        gl.vertexAttribPointer(p.attribs.aSize, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.speed);
        gl.enableVertexAttribArray(p.attribs.aSpeed);
        gl.vertexAttribPointer(p.attribs.aSpeed, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, b.offset);
        gl.enableVertexAttribArray(p.attribs.aOffset);
        gl.vertexAttribPointer(p.attribs.aOffset, 1, gl.FLOAT, false, 0, 0);

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, b.count);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    // --- Utilities ---

    createProgram(vsSource, fsSource) {
        const gl = this.gl;

        const vs = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vs, vsSource);
        gl.compileShader(vs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
            console.error('VS Error:', gl.getShaderInfoLog(vs));
            return null;
        }

        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, fsSource);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
            console.error('FS Error:', gl.getShaderInfoLog(fs));
            return null;
        }

        const program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error('Program Link Error:', gl.getProgramInfoLog(program));
            return null;
        }

        const uniforms = {};
        const attribs = {};

        const numUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < numUniforms; i++) {
            const info = gl.getActiveUniform(program, i);
            uniforms[info.name] = gl.getUniformLocation(program, info.name);
        }

        const numAttribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < numAttribs; i++) {
            const info = gl.getActiveAttrib(program, i);
            attribs[info.name] = gl.getAttribLocation(program, info.name);
        }

        return { program, uniforms, attribs };
    }

    initQuadBuffer() {
        // Initialized in initFlowProgram
    }
}
