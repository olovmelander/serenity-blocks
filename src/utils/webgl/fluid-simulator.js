/**
 * FluidSimulator - Port of WebGL Fluid Simulation by Pavel Dobryakov
 * Source: https://github.com/paveldogreat/WebGL-Fluid-Simulation
 * License: MIT
 */

export default class FluidSimulator {
    constructor(canvas, config = {}) {
        this.canvas = canvas;
        this.config = {
            SIM_RESOLUTION: 128,
            DYE_RESOLUTION: 1024,
            CAPTURE_RESOLUTION: 512,
            DENSITY_DISSIPATION: 1,
            VELOCITY_DISSIPATION: 0.2,
            PRESSURE: 0.8,
            PRESSURE_ITERATIONS: 20,
            CURL: 30,
            SPLAT_RADIUS: 0.25,
            SPLAT_FORCE: 6000,
            SHADING: true,
            COLORFUL: true,
            COLOR_UPDATE_SPEED: 10,
            PAUSED: false,
            BACK_COLOR: { r: 0, g: 0, b: 0 },
            TRANSPARENT: false,
            BLOOM: false,
            BLOOM_ITERATIONS: 8,
            BLOOM_RESOLUTION: 256,
            BLOOM_INTENSITY: 0.8,
            BLOOM_THRESHOLD: 0.6,
            BLOOM_SOFT_KNEE: 0.7,
            SUNRAYS: false,
            SUNRAYS_RESOLUTION: 196,
            SUNRAYS_WEIGHT: 1.0,
            ...config,
        };

        this.gl = null;
        this.ext = null;
        this.programs = {};
        this.materials = {};
        this.fbos = {};

        // State
        this.dye = null;
        this.velocity = null;
        this.divergence = null;
        this.curl = null;
        this.pressure = null;
        this.bloom = null;
        this.bloomFramebuffers = [];
        this.sunrays = null;
        this.sunraysTemp = null;
        this.ditheringTexture = null;
    }

    async init() {
        const { gl, ext } = this.getWebGLContext(this.canvas);
        this.gl = gl;
        this.ext = ext;

        if (!ext.supportLinearFiltering) {
            this.config.DYE_RESOLUTION = 512;
            this.config.SHADING = false;
            this.config.BLOOM = false;
            this.config.SUNRAYS = false;
        }

        // Compile Shaders
        this.initPrograms();

        // Init Framebuffers
        this.initFramebuffers();

        // Load Dithering Texture (procedural fallback if image fails)
        this.ditheringTexture = this.createTextureAsync('LDR_LLL1_0.png');

        this.updateKeywords();

        return true;
    }

    getWebGLContext(canvas) {
        const params = {
            alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false,
        };

        let gl = canvas.getContext('webgl2', params);
        const isWebGL2 = !!gl;
        if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

        let halfFloat;
        let supportLinearFiltering;
        if (isWebGL2) {
            gl.getExtension('EXT_color_buffer_float');
            supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
        } else {
            halfFloat = gl.getExtension('OES_texture_half_float');
            supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
        }

        gl.clearColor(0.0, 0.0, 0.0, 1.0);

        const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
        let formatRGBA;
        let formatRG;
        let formatR;

        if (isWebGL2) {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
        } else {
            formatRGBA = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatRG = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
            formatR = this.getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        }

        return {
            gl,
            ext: {
                formatRGBA,
                formatRG,
                formatR,
                halfFloatTexType,
                supportLinearFiltering,
            },
        };
    }

    getSupportedFormat(gl, internalFormat, format, type) {
        if (!this.supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
            case gl.R16F:
                return this.getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return this.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
            }
        }

        return {
            internalFormat,
            format,
        };
    }

    supportRenderTextureFormat(gl, internalFormat, format, type) {
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        return status == gl.FRAMEBUFFER_COMPLETE;
    }

    compileShader(type, source, keywords) {
        const { gl } = this;
        source = this.addKeywords(source, keywords);

        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.trace(gl.getShaderInfoLog(shader));

        return shader;
    }

    addKeywords(source, keywords) {
        if (keywords == null) return source;
        let keywordsString = '';
        keywords.forEach((keyword) => {
            keywordsString += `#define ${keyword}\n`;
        });
        return keywordsString + source;
    }

    initPrograms() {
        const { gl } = this;

        // Vertex Shaders
        const baseVertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform vec2 texelSize;
            void main () {
                vUv = aPosition * 0.5 + 0.5;
                vL = vUv - vec2(texelSize.x, 0.0);
                vR = vUv + vec2(texelSize.x, 0.0);
                vT = vUv + vec2(0.0, texelSize.y);
                vB = vUv - vec2(0.0, texelSize.y);
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const blurVertexShaderSource = `
            precision highp float;
            attribute vec2 aPosition;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            uniform vec2 texelSize;
            void main () {
                vUv = aPosition * 0.5 + 0.5;
                float offset = 1.33333333;
                vL = vUv - texelSize * offset;
                vR = vUv + texelSize * offset;
                gl_Position = vec4(aPosition, 0.0, 1.0);
            }
        `;

        const baseVertexShader = this.compileShader(gl.VERTEX_SHADER, baseVertexShaderSource);
        const blurVertexShader = this.compileShader(gl.VERTEX_SHADER, blurVertexShaderSource);

        // Fragment Shaders
        const blurShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            uniform sampler2D uTexture;
            void main () {
                vec4 sum = texture2D(uTexture, vUv) * 0.29411764;
                sum += texture2D(uTexture, vL) * 0.35294117;
                sum += texture2D(uTexture, vR) * 0.35294117;
                gl_FragColor = sum;
            }
        `;

        const copyShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            uniform sampler2D uTexture;
            void main () {
                gl_FragColor = texture2D(uTexture, vUv);
            }
        `;

        const clearShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            uniform sampler2D uTexture;
            uniform float value;
            void main () {
                gl_FragColor = value * texture2D(uTexture, vUv);
            }
        `;

        const colorShaderSource = `
            precision mediump float;
            uniform vec4 color;
            void main () {
                gl_FragColor = color;
            }
        `;

        const displayShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uTexture;
            uniform sampler2D uBloom;
            uniform sampler2D uSunrays;
            uniform sampler2D uDithering;
            uniform vec2 ditherScale;
            uniform vec2 texelSize;
            vec3 linearToGamma (vec3 color) {
                color = max(color, vec3(0));
                return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));
            }
            void main () {
                vec3 c = texture2D(uTexture, vUv).rgb;
            #ifdef SHADING
                vec3 lc = texture2D(uTexture, vL).rgb;
                vec3 rc = texture2D(uTexture, vR).rgb;
                vec3 tc = texture2D(uTexture, vT).rgb;
                vec3 bc = texture2D(uTexture, vB).rgb;
                float dx = length(rc) - length(lc);
                float dy = length(tc) - length(bc);
                vec3 n = normalize(vec3(dx, dy, length(texelSize)));
                vec3 l = vec3(0.0, 0.0, 1.0);
                float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);
                c *= diffuse;
            #endif
            #ifdef BLOOM
                vec3 bloom = texture2D(uBloom, vUv).rgb;
            #endif
            #ifdef SUNRAYS
                float sunrays = texture2D(uSunrays, vUv).r;
                c *= sunrays;
            #ifdef BLOOM
                bloom *= sunrays;
            #endif
            #endif
            #ifdef BLOOM
                float noise = texture2D(uDithering, vUv * ditherScale).r;
                noise = noise * 2.0 - 1.0;
                bloom += noise / 255.0;
                bloom = linearToGamma(bloom);
                c += bloom;
            #endif
                float a = max(c.r, max(c.g, c.b));
                gl_FragColor = vec4(c, a);
            }
        `;

        const bloomPrefilterShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform vec3 curve;
            uniform float threshold;
            void main () {
                vec3 c = texture2D(uTexture, vUv).rgb;
                float br = max(c.r, max(c.g, c.b));
                float rq = clamp(br - curve.x, 0.0, curve.y);
                rq = curve.z * rq * rq;
                c *= max(rq, br - threshold) / max(br, 0.0001);
                gl_FragColor = vec4(c, 0.0);
            }
        `;

        const bloomBlurShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uTexture;
            void main () {
                vec4 sum = vec4(0.0);
                sum += texture2D(uTexture, vL);
                sum += texture2D(uTexture, vR);
                sum += texture2D(uTexture, vT);
                sum += texture2D(uTexture, vB);
                sum *= 0.25;
                gl_FragColor = sum;
            }
        `;

        const bloomFinalShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uTexture;
            uniform float intensity;
            void main () {
                vec4 sum = vec4(0.0);
                sum += texture2D(uTexture, vL);
                sum += texture2D(uTexture, vR);
                sum += texture2D(uTexture, vT);
                sum += texture2D(uTexture, vB);
                sum *= 0.25;
                gl_FragColor = sum * intensity;
            }
        `;

        const sunraysMaskShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            void main () {
                vec4 c = texture2D(uTexture, vUv);
                float br = max(c.r, max(c.g, c.b));
                c.a = br;
                gl_FragColor = c;
            }
        `;

        const sunraysShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTexture;
            uniform float weight;
            #define ITERATIONS 16
            void main () {
                float Density = 0.3;
                float Decay = 0.95;
                float Exposure = 0.7;
                vec2 coord = vUv;
                vec2 dir = vUv - 0.5;
                dir *= 1.0 / float(ITERATIONS) * Density;
                float illuminationDecay = 1.0;
                float color = texture2D(uTexture, vUv).a;
                for (int i = 0; i < ITERATIONS; i++) {
                    coord -= dir;
                    float col = texture2D(uTexture, coord).a;
                    color += col * illuminationDecay * weight;
                    illuminationDecay *= Decay;
                }
                gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
            }
        `;

        const splatShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uTarget;
            uniform float aspectRatio;
            uniform vec3 color;
            uniform vec2 point;
            uniform float radius;
            void main () {
                vec2 p = vUv - point.xy;
                p.x *= aspectRatio;
                vec3 splat = exp(-dot(p, p) / radius) * color;
                vec3 base = texture2D(uTarget, vUv).xyz;
                gl_FragColor = vec4(base + splat, 1.0);
            }
        `;

        const advectionShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            uniform sampler2D uVelocity;
            uniform sampler2D uSource;
            uniform vec2 texelSize;
            uniform vec2 dyeTexelSize;
            uniform float dt;
            uniform float dissipation;
            vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
                vec2 st = uv / tsize - 0.5;
                vec2 iuv = floor(st);
                vec2 fuv = fract(st);
                vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
                return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
            }
            void main () {
            #ifdef MANUAL_FILTERING
                vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
                vec4 result = bilerp(uSource, coord, dyeTexelSize);
            #else
                vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
                vec4 result = texture2D(uSource, coord);
            #endif
                float decay = 1.0 + dissipation * dt;
                gl_FragColor = result / decay;
            }
        `;

        const divergenceShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uVelocity;
            void main () {
                float L = texture2D(uVelocity, vL).x;
                float R = texture2D(uVelocity, vR).x;
                float T = texture2D(uVelocity, vT).y;
                float B = texture2D(uVelocity, vB).y;
                vec2 C = texture2D(uVelocity, vUv).xy;
                if (vL.x < 0.0) { L = -C.x; }
                if (vR.x > 1.0) { R = -C.x; }
                if (vT.y > 1.0) { T = -C.y; }
                if (vB.y < 0.0) { B = -C.y; }
                float div = 0.5 * (R - L + T - B);
                gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
            }
        `;

        const curlShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uVelocity;
            void main () {
                float L = texture2D(uVelocity, vL).y;
                float R = texture2D(uVelocity, vR).y;
                float T = texture2D(uVelocity, vT).x;
                float B = texture2D(uVelocity, vB).x;
                float vorticity = R - L - T + B;
                gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
            }
        `;

        const vorticityShaderSource = `
            precision highp float;
            precision highp sampler2D;
            varying vec2 vUv;
            varying vec2 vL;
            varying vec2 vR;
            varying vec2 vT;
            varying vec2 vB;
            uniform sampler2D uVelocity;
            uniform sampler2D uCurl;
            uniform float curl;
            uniform float dt;
            void main () {
                float L = texture2D(uCurl, vL).x;
                float R = texture2D(uCurl, vR).x;
                float T = texture2D(uCurl, vT).x;
                float B = texture2D(uCurl, vB).x;
                float C = texture2D(uCurl, vUv).x;
                vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                force /= length(force) + 0.0001;
                force *= curl * C;
                force.y *= -1.0;
                vec2 velocity = texture2D(uVelocity, vUv).xy;
                velocity += force * dt;
                velocity = min(max(velocity, -1000.0), 1000.0);
                gl_FragColor = vec4(velocity, 0.0, 1.0);
            }
        `;

        const pressureShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uDivergence;
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                float C = texture2D(uPressure, vUv).x;
                float divergence = texture2D(uDivergence, vUv).x;
                float pressure = (L + R + B + T - divergence) * 0.25;
                gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
            }
        `;

        const gradientSubtractShaderSource = `
            precision mediump float;
            precision mediump sampler2D;
            varying highp vec2 vUv;
            varying highp vec2 vL;
            varying highp vec2 vR;
            varying highp vec2 vT;
            varying highp vec2 vB;
            uniform sampler2D uPressure;
            uniform sampler2D uVelocity;
            void main () {
                float L = texture2D(uPressure, vL).x;
                float R = texture2D(uPressure, vR).x;
                float T = texture2D(uPressure, vT).x;
                float B = texture2D(uPressure, vB).x;
                vec2 velocity = texture2D(uVelocity, vUv).xy;
                velocity.xy -= vec2(R - L, T - B);
                gl_FragColor = vec4(velocity, 0.0, 1.0);
            }
        `;

        this.programs.blur = new Program(gl, blurVertexShader, this.compileShader(gl.FRAGMENT_SHADER, blurShaderSource));
        this.programs.copy = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, copyShaderSource));
        this.programs.clear = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, clearShaderSource));
        this.programs.color = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, colorShaderSource));
        this.programs.bloomPrefilter = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, bloomPrefilterShaderSource));
        this.programs.bloomBlur = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, bloomBlurShaderSource));
        this.programs.bloomFinal = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, bloomFinalShaderSource));
        this.programs.sunraysMask = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, sunraysMaskShaderSource));
        this.programs.sunrays = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, sunraysShaderSource));
        this.programs.splat = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, splatShaderSource));
        this.programs.advection = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, advectionShaderSource, this.ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']));
        this.programs.divergence = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, divergenceShaderSource));
        this.programs.curl = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, curlShaderSource));
        this.programs.vorticity = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, vorticityShaderSource));
        this.programs.pressure = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, pressureShaderSource));
        this.programs.gradientSubtract = new Program(gl, baseVertexShader, this.compileShader(gl.FRAGMENT_SHADER, gradientSubtractShaderSource));

        this.materials.display = new Material(gl, baseVertexShader, displayShaderSource);
    }

    initFramebuffers() {
        const { gl } = this;
        const { ext } = this;

        const simRes = this.getResolution(this.config.SIM_RESOLUTION);
        const dyeRes = this.getResolution(this.config.DYE_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const rg = ext.formatRG;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        gl.disable(gl.BLEND);

        if (this.dye == null) this.dye = this.createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
        else this.dye = this.resizeDoubleFBO(this.dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);

        if (this.velocity == null) this.velocity = this.createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
        else this.velocity = this.resizeDoubleFBO(this.velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);

        this.divergence = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.curl = this.createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
        this.pressure = this.createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);

        this.initBloomFramebuffers();
        this.initSunraysFramebuffers();
    }

    initBloomFramebuffers() {
        const { gl } = this;
        const { ext } = this;
        const res = this.getResolution(this.config.BLOOM_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const rgba = ext.formatRGBA;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        this.bloom = this.createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

        this.bloomFramebuffers.length = 0;
        for (let i = 0; i < this.config.BLOOM_ITERATIONS; i++) {
            const width = res.width >> (i + 1);
            const height = res.height >> (i + 1);

            if (width < 2 || height < 2) break;

            const fbo = this.createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
            this.bloomFramebuffers.push(fbo);
        }
    }

    initSunraysFramebuffers() {
        const { gl } = this;
        const { ext } = this;
        const res = this.getResolution(this.config.SUNRAYS_RESOLUTION);

        const texType = ext.halfFloatTexType;
        const r = ext.formatR;
        const filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

        this.sunrays = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
        this.sunraysTemp = this.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    }

    createFBO(w, h, internalFormat, format, type, param) {
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0);
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const texelSizeX = 1.0 / w;
        const texelSizeY = 1.0 / h;

        return {
            texture,
            fbo,
            width: w,
            height: h,
            texelSizeX,
            texelSizeY,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            },
        };
    }

    createDoubleFBO(w, h, internalFormat, format, type, param) {
        let fbo1 = this.createFBO(w, h, internalFormat, format, type, param);
        let fbo2 = this.createFBO(w, h, internalFormat, format, type, param);

        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            get read() {
                return fbo1;
            },
            set read(value) {
                fbo1 = value;
            },
            get write() {
                return fbo2;
            },
            set write(value) {
                fbo2 = value;
            },
            swap() {
                const temp = fbo1;
                fbo1 = fbo2;
                fbo2 = temp;
            },
        };
    }

    resizeFBO(target, w, h, internalFormat, format, type, param) {
        const newFBO = this.createFBO(w, h, internalFormat, format, type, param);
        this.programs.copy.bind();
        this.gl.uniform1i(this.programs.copy.uniforms.uTexture, target.attach(0));
        this.blit(newFBO);
        return newFBO;
    }

    resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
        if (target.width == w && target.height == h) return target;
        target.read = this.resizeFBO(target.read, w, h, internalFormat, format, type, param);
        target.write = this.createFBO(w, h, internalFormat, format, type, param);
        target.width = w;
        target.height = h;
        target.texelSizeX = 1.0 / w;
        target.texelSizeY = 1.0 / h;
        return target;
    }

    createTextureAsync(url) {
        const { gl } = this;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

        // Generate procedural noise immediately
        // This ensures we have valid data for dithering and avoids any "grid" artifacts
        // from uninitialized textures or failed image loads.
        const size = 128;
        const data = new Uint8Array(size * size * 3);
        for (let i = 0; i < size * size * 3; i++) {
            data[i] = Math.floor(Math.random() * 255);
        }

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data);

        const obj = {
            texture,
            width: size,
            height: size,
            attach(id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            },
        };

        return obj;
    }

    updateKeywords() {
        const displayKeywords = [];
        if (this.config.SHADING) displayKeywords.push('SHADING');
        if (this.config.BLOOM) displayKeywords.push('BLOOM');
        if (this.config.SUNRAYS) displayKeywords.push('SUNRAYS');
        this.materials.display.setKeywords(displayKeywords);
    }

    step(dt) {
        const { gl } = this;
        const { ext } = this;
        const { config } = this;

        gl.disable(gl.BLEND);

        this.programs.curl.bind();
        gl.uniform2f(this.programs.curl.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.programs.curl.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.curl);

        this.programs.vorticity.bind();
        gl.uniform2f(this.programs.vorticity.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.programs.vorticity.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.programs.vorticity.uniforms.uCurl, this.curl.attach(1));
        gl.uniform1f(this.programs.vorticity.uniforms.curl, config.CURL);
        gl.uniform1f(this.programs.vorticity.uniforms.dt, dt);
        this.blit(this.velocity.write);
        this.velocity.swap();

        this.programs.divergence.bind();
        gl.uniform2f(this.programs.divergence.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.programs.divergence.uniforms.uVelocity, this.velocity.read.attach(0));
        this.blit(this.divergence);

        this.programs.clear.bind();
        gl.uniform1i(this.programs.clear.uniforms.uTexture, this.pressure.read.attach(0));
        gl.uniform1f(this.programs.clear.uniforms.value, config.PRESSURE);
        this.blit(this.pressure.write);
        this.pressure.swap();

        this.programs.pressure.bind();
        gl.uniform2f(this.programs.pressure.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.programs.pressure.uniforms.uDivergence, this.divergence.attach(0));
        for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
            gl.uniform1i(this.programs.pressure.uniforms.uPressure, this.pressure.read.attach(1));
            this.blit(this.pressure.write);
            this.pressure.swap();
        }

        this.programs.gradientSubtract.bind();
        gl.uniform2f(this.programs.gradientSubtract.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uPressure, this.pressure.read.attach(0));
        gl.uniform1i(this.programs.gradientSubtract.uniforms.uVelocity, this.velocity.read.attach(1));
        this.blit(this.velocity.write);
        this.velocity.swap();

        this.programs.advection.bind();
        gl.uniform2f(this.programs.advection.uniforms.texelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        if (!ext.supportLinearFiltering) gl.uniform2f(this.programs.advection.uniforms.dyeTexelSize, this.velocity.texelSizeX, this.velocity.texelSizeY);
        const velocityId = this.velocity.read.attach(0);
        gl.uniform1i(this.programs.advection.uniforms.uVelocity, velocityId);
        gl.uniform1i(this.programs.advection.uniforms.uSource, velocityId);
        gl.uniform1f(this.programs.advection.uniforms.dt, dt);
        gl.uniform1f(this.programs.advection.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        this.blit(this.velocity.write);
        this.velocity.swap();

        if (!ext.supportLinearFiltering) gl.uniform2f(this.programs.advection.uniforms.dyeTexelSize, this.dye.texelSizeX, this.dye.texelSizeY);
        gl.uniform1i(this.programs.advection.uniforms.uVelocity, this.velocity.read.attach(0));
        gl.uniform1i(this.programs.advection.uniforms.uSource, this.dye.read.attach(1));
        gl.uniform1f(this.programs.advection.uniforms.dissipation, config.DENSITY_DISSIPATION);
        this.blit(this.dye.write);
        this.dye.swap();
    }

    render(target) {
        const { gl } = this;
        const { config } = this;

        if (config.BLOOM) this.applyBloom(this.dye.read, this.bloom);
        if (config.SUNRAYS) {
            this.applySunrays(this.dye.read, this.dye.write, this.sunrays);
            this.blur(this.sunrays, this.sunraysTemp, 1);
        }

        if (target == null || !config.TRANSPARENT) {
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.BLEND);
        } else {
            gl.disable(gl.BLEND);
        }

        if (!config.TRANSPARENT) this.drawColor(target, this.normalizeColor(config.BACK_COLOR));

        this.drawDisplay(target);
    }

    drawColor(target, color) {
        const { gl } = this;
        this.programs.color.bind();
        gl.uniform4f(this.programs.color.uniforms.color, color.r, color.g, color.b, 1);
        this.blit(target);
    }

    drawDisplay(target) {
        const { gl } = this;
        const { config } = this;
        const width = target == null ? gl.drawingBufferWidth : target.width;
        const height = target == null ? gl.drawingBufferHeight : target.height;

        this.materials.display.bind();
        if (config.SHADING) gl.uniform2f(this.materials.display.uniforms.texelSize, 1.0 / width, 1.0 / height);
        gl.uniform1i(this.materials.display.uniforms.uTexture, this.dye.read.attach(0));
        if (config.BLOOM) {
            gl.uniform1i(this.materials.display.uniforms.uBloom, this.bloom.attach(1));
            gl.uniform1i(this.materials.display.uniforms.uDithering, this.ditheringTexture.attach(2));
            const scale = this.getTextureScale(this.ditheringTexture, width, height);
            gl.uniform2f(this.materials.display.uniforms.ditherScale, scale.x, scale.y);
        }
        if (config.SUNRAYS) gl.uniform1i(this.materials.display.uniforms.uSunrays, this.sunrays.attach(3));
        this.blit(target);
    }

    applyBloom(source, destination) {
        const { gl } = this;
        const { config } = this;
        if (this.bloomFramebuffers.length < 2) return;

        let last = destination;

        gl.disable(gl.BLEND);
        this.programs.bloomPrefilter.bind();
        const knee = config.BLOOM_THRESHOLD * config.BLOOM_SOFT_KNEE + 0.0001;
        const curve0 = config.BLOOM_THRESHOLD - knee;
        const curve1 = knee * 2;
        const curve2 = 0.25 / knee;
        gl.uniform3f(this.programs.bloomPrefilter.uniforms.curve, curve0, curve1, curve2);
        gl.uniform1f(this.programs.bloomPrefilter.uniforms.threshold, config.BLOOM_THRESHOLD);
        gl.uniform1i(this.programs.bloomPrefilter.uniforms.uTexture, source.attach(0));
        this.blit(last);

        this.programs.bloomBlur.bind();
        for (let i = 0; i < this.bloomFramebuffers.length; i++) {
            const dest = this.bloomFramebuffers[i];
            gl.uniform2f(this.programs.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
            gl.uniform1i(this.programs.bloomBlur.uniforms.uTexture, last.attach(0));
            this.blit(dest);
            last = dest;
        }

        gl.blendFunc(gl.ONE, gl.ONE);
        gl.enable(gl.BLEND);

        for (let i = this.bloomFramebuffers.length - 2; i >= 0; i--) {
            const baseTex = this.bloomFramebuffers[i];
            gl.uniform2f(this.programs.bloomBlur.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
            gl.uniform1i(this.programs.bloomBlur.uniforms.uTexture, last.attach(0));
            gl.viewport(0, 0, baseTex.width, baseTex.height);
            this.blit(baseTex);
            last = baseTex;
        }

        gl.disable(gl.BLEND);
        this.programs.bloomFinal.bind();
        gl.uniform2f(this.programs.bloomFinal.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        gl.uniform1i(this.programs.bloomFinal.uniforms.uTexture, last.attach(0));
        gl.uniform1f(this.programs.bloomFinal.uniforms.intensity, config.BLOOM_INTENSITY);
        this.blit(destination);
    }

    applySunrays(source, mask, destination) {
        const { gl } = this;
        const { config } = this;
        gl.disable(gl.BLEND);
        this.programs.sunraysMask.bind();
        gl.uniform1i(this.programs.sunraysMask.uniforms.uTexture, source.attach(0));
        this.blit(mask);

        this.programs.sunrays.bind();
        gl.uniform1f(this.programs.sunrays.uniforms.weight, config.SUNRAYS_WEIGHT);
        gl.uniform1i(this.programs.sunrays.uniforms.uTexture, mask.attach(0));
        this.blit(destination);
    }

    blur(target, temp, iterations) {
        const { gl } = this;
        this.programs.blur.bind();
        for (let i = 0; i < iterations; i++) {
            gl.uniform2f(this.programs.blur.uniforms.texelSize, target.texelSizeX, 0.0);
            gl.uniform1i(this.programs.blur.uniforms.uTexture, target.attach(0));
            this.blit(temp);

            gl.uniform2f(this.programs.blur.uniforms.texelSize, 0.0, target.texelSizeY);
            gl.uniform1i(this.programs.blur.uniforms.uTexture, temp.attach(0));
            this.blit(target);
        }
    }

    splat(x, y, dx, dy, color) {
        const { gl } = this;
        const { config } = this;
        this.programs.splat.bind();
        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.velocity.read.attach(0));
        gl.uniform1f(this.programs.splat.uniforms.aspectRatio, this.canvas.width / this.canvas.height);
        gl.uniform2f(this.programs.splat.uniforms.point, x, y);
        gl.uniform3f(this.programs.splat.uniforms.color, dx, dy, 0.0);
        gl.uniform1f(this.programs.splat.uniforms.radius, this.correctRadius(config.SPLAT_RADIUS / 100.0));
        this.blit(this.velocity.write);
        this.velocity.swap();

        gl.uniform1i(this.programs.splat.uniforms.uTarget, this.dye.read.attach(0));
        gl.uniform3f(this.programs.splat.uniforms.color, color.r, color.g, color.b);
        this.blit(this.dye.write);
        this.dye.swap();
    }

    correctRadius(radius) {
        const aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio > 1) radius *= aspectRatio;
        return radius;
    }

    blit(target, clear = false) {
        const { gl } = this;

        // Init blit geometry if needed
        if (!this.blitBuffer) {
            this.blitBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.blitBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
            this.blitElementBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blitElementBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.blitBuffer);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blitElementBuffer);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        if (target == null) {
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        } else {
            gl.viewport(0, 0, target.width, target.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
        }
        if (clear) {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    getResolution(resolution) {
        let aspectRatio = this.canvas.width / this.canvas.height;
        if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;

        const min = Math.round(resolution);
        const max = Math.round(resolution * aspectRatio);

        if (this.canvas.width > this.canvas.height) return { width: max, height: min };
        return { width: min, height: max };
    }

    getTextureScale(texture, width, height) {
        return {
            x: width / texture.width,
            y: height / texture.height,
        };
    }

    normalizeColor(input) {
        return {
            r: input.r / 255,
            g: input.g / 255,
            b: input.b / 255,
        };
    }

    resize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.initFramebuffers();
        this.updateKeywords();
    }

    cleanup() {
        const { gl } = this;
        if (!gl) return;

        // Helper to delete a single FBO (texture + framebuffer)
        const deleteFBO = (fbo) => {
            if (!fbo) return;
            if (fbo.texture) gl.deleteTexture(fbo.texture);
            if (fbo.fbo) gl.deleteFramebuffer(fbo.fbo);
        };

        // Helper to delete a double FBO (read + write)
        const deleteDoubleFBO = (doubleFbo) => {
            if (!doubleFbo) return;
            deleteFBO(doubleFbo.read);
            deleteFBO(doubleFbo.write);
        };

        // Delete double FBOs
        deleteDoubleFBO(this.dye);
        deleteDoubleFBO(this.velocity);
        deleteDoubleFBO(this.pressure);

        // Delete single FBOs
        deleteFBO(this.divergence);
        deleteFBO(this.curl);
        deleteFBO(this.bloom);
        deleteFBO(this.sunrays);
        deleteFBO(this.sunraysTemp);

        // Delete bloom framebuffer chain
        if (this.bloomFramebuffers) {
            for (const fbo of this.bloomFramebuffers) {
                deleteFBO(fbo);
            }
            this.bloomFramebuffers.length = 0;
        }

        // Delete dithering texture
        if (this.ditheringTexture && this.ditheringTexture.texture) {
            gl.deleteTexture(this.ditheringTexture.texture);
        }

        // Delete shader programs
        for (const key in this.programs) {
            const prog = this.programs[key];
            if (prog && prog.program) {
                gl.deleteProgram(prog.program);
            }
        }

        // Delete material programs
        for (const key in this.materials) {
            const mat = this.materials[key];
            if (mat && mat.programs) {
                for (const hash in mat.programs) {
                    if (mat.programs[hash]) {
                        gl.deleteProgram(mat.programs[hash]);
                    }
                }
            }
        }

        // Delete vertex/index buffers
        if (this.blitBuffer) gl.deleteBuffer(this.blitBuffer);
        if (this.blitElementBuffer) gl.deleteBuffer(this.blitElementBuffer);

        // Nullify references
        this.dye = null;
        this.velocity = null;
        this.divergence = null;
        this.curl = null;
        this.pressure = null;
        this.bloom = null;
        this.sunrays = null;
        this.sunraysTemp = null;
        this.ditheringTexture = null;
        this.blitBuffer = null;
        this.blitElementBuffer = null;
        this.programs = {};
        this.materials = {};
        this.gl = null;
        this.ext = null;
    }
}

class Program {
    constructor(gl, vertexShader, fragmentShader) {
        this.gl = gl;
        this.uniforms = {};
        this.program = this.createProgram(vertexShader, fragmentShader);
        this.uniforms = this.getUniforms(this.program);
    }

    bind() {
        this.gl.useProgram(this.program);
    }

    createProgram(vertexShader, fragmentShader) {
        const { gl } = this;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.trace(gl.getProgramInfoLog(program));

        return program;
    }

    getUniforms(program) {
        const { gl } = this;
        const uniforms = {};
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }
        return uniforms;
    }
}

class Material {
    constructor(gl, vertexShader, fragmentShaderSource) {
        this.gl = gl;
        this.vertexShader = vertexShader;
        this.fragmentShaderSource = fragmentShaderSource;
        this.programs = [];
        this.activeProgram = null;
        this.uniforms = [];
    }

    setKeywords(keywords) {
        let hash = 0;
        for (let i = 0; i < keywords.length; i++) hash += this.hashCode(keywords[i]);

        let program = this.programs[hash];
        if (program == null) {
            const fragmentShader = this.compileShader(this.gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
            program = this.createProgram(this.vertexShader, fragmentShader);
            this.programs[hash] = program;
        }

        if (program == this.activeProgram) return;

        this.uniforms = this.getUniforms(program);
        this.activeProgram = program;
    }

    bind() {
        this.gl.useProgram(this.activeProgram);
    }

    hashCode(s) {
        if (s.length == 0) return 0;
        let hash = 0;
        for (let i = 0; i < s.length; i++) {
            hash = (hash << 5) - hash + s.charCodeAt(i);
            hash |= 0; // Convert to 32bit integer
        }
        return hash;
    }

    compileShader(type, source, keywords) {
        const { gl } = this;
        source = this.addKeywords(source, keywords);

        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.trace(gl.getShaderInfoLog(shader));

        return shader;
    }

    addKeywords(source, keywords) {
        if (keywords == null) return source;
        let keywordsString = '';
        keywords.forEach((keyword) => {
            keywordsString += `#define ${keyword}\n`;
        });
        return keywordsString + source;
    }

    createProgram(vertexShader, fragmentShader) {
        const { gl } = this;
        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) console.trace(gl.getProgramInfoLog(program));

        return program;
    }

    getUniforms(program) {
        const { gl } = this;
        const uniforms = {};
        const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < uniformCount; i++) {
            const uniformName = gl.getActiveUniform(program, i).name;
            uniforms[uniformName] = gl.getUniformLocation(program, uniformName);
        }
        return uniforms;
    }
}
