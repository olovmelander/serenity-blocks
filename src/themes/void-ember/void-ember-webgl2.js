/* eslint-disable import/no-unresolved */
import commonGLSL from './glsl/void-ember-common.glsl?raw';
import environmentGLSL from './glsl/environment.glsl?raw';
import sceneGLSL from './glsl/scene.glsl?raw';
import postGLSL from './glsl/post.glsl?raw';
import lensFlareGLSL from './glsl/lens-flare.glsl?raw';

const PARAM_NAMES = ['resolution', 'sim', 'ember', 'reaction', 'quality', 'post',
    'colorA', 'colorB', 'misc', 'fx', 'star0', 'star1'];
const PARAMS = `struct Params { ${PARAM_NAMES.map((name) => `vec4 ${name};`).join('\n')} };
uniform Params params;`;
const HEADER = '#version 300 es\nprecision highp float;\n';
const VERTEX = `${HEADER}
out vec2 vUv;
void main() {
    vec2 position = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
    gl_Position = vec4(position, 0.0, 1.0);
    vUv = position * 0.5 + 0.5;
}`;
const FRAGMENT_HEADER = `${HEADER}${PARAMS}\nin vec2 vUv;\nout vec4 outColor;\n`;

const PARTICLE_VERTEX = `${HEADER}${PARAMS}${commonGLSL}
out float vAlpha;
out vec3 vColor;
void main() {
    float index = float(gl_VertexID);
    float fraction = index / max(params.quality.w, 1.0);
    float seed = fract(sin(index * 91.173 + 0.17) * 43758.5453123);
    float lifetime = fraction < 0.5 ? 1.8 : (fraction < 0.82 ? 5.0 : 14.0);
    float age = mod(params.sim.x + seed * lifetime, lifetime);
    float angle = seed * VE_TAU;
    vec2 direction = vec2(cos(angle), sin(angle));
    vec2 uv;
    float fade = sin(age / lifetime * VE_PI);
    if (fraction < 0.82) {
        float speed = fraction < 0.5 ? 0.07 : 0.023;
        uv = params.ember.xy + direction * (0.015 + age * speed * (1.0 + params.fx.y * 1.5));
        uv.y += age * (fraction < 0.5 ? 0.025 : 0.012);
        uv.x += sin(age * 2.0 + seed * 20.0) * age * 0.005;
        vAlpha = fade * (fraction < 0.5 ? 0.7 : 0.35) * (1.0 + params.fx.y * 0.3);
    } else {
        uv = fract(vec2(seed, ve_hash12(vec2(index, 2.7))) +
            vec2(sin(seed * 20.0), cos(seed * 31.0)) * params.sim.x * 0.003);
        vAlpha = fade * 0.14;
    }
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = (fraction < 0.82 ? 2.0 + seed * 4.0 : 0.8 + seed * 1.4) *
        (1.0 + params.fx.y * 0.5);
    vColor = ve_blackbody(clamp(params.star0.x + (fraction < 0.5 ? 0.22 : -0.08), 0.0, 1.0));
}`;
const PARTICLE_FRAGMENT = `${HEADER}
in float vAlpha;
in vec3 vColor;
out vec4 outColor;
void main() {
    float radius = length(gl_PointCoord - 0.5);
    float alpha = exp(-radius * radius * 18.0) * vAlpha;
    outColor = vec4(vColor * alpha, alpha);
}`;

/** The current WGSL hero/environment on WebGL2; no storage buffers or compute. */
export class VoidEmberWebGL2Renderer {
    static create(canvas) {
        const gl = canvas?.getContext('webgl2', { alpha: false, antialias: false, depth: false });
        if (!gl) return null;
        const renderer = new VoidEmberWebGL2Renderer(gl, canvas);
        try {
            renderer.initialize();
            return renderer;
        } catch (error) {
            renderer.dispose();
            throw error;
        }
    }

    constructor(gl, canvas) {
        this.gl = gl;
        this.canvas = canvas;
        this.programs = [];
        this.targets = [];
        this.width = 0;
        this.height = 0;
        this.isWebGL2 = true;
    }

    initialize() {
        const { gl } = this;
        this.hdr = !!gl.getExtension('EXT_color_buffer_float');
        this.maxTextureDimension = gl.getParameter?.(gl.MAX_TEXTURE_SIZE) || 16384;
        this.vao = gl.createVertexArray();
        const scene = `${FRAGMENT_HEADER}${commonGLSL}${environmentGLSL}${sceneGLSL}
void main() { outColor = ve_scene(vUv); }`;
        const post = `${FRAGMENT_HEADER}uniform sampler2D scene_texture;
uniform sampler2D bloom_texture;
${commonGLSL}${lensFlareGLSL}${postGLSL}
void main() { outColor = ve_post(vUv); }`;
        const bright = `${FRAGMENT_HEADER}uniform sampler2D scene_texture;
uniform sampler2D bloom_texture;
${commonGLSL}${lensFlareGLSL}${postGLSL}
void main() {
    vec2 stepUv = params.resolution.zw * 2.0;
    vec3 color = ve_bright(vUv) * 0.2;
    for (int a = 0; a < 8; a++) {
        float angle = float(a) * 0.785398;
        color += ve_bright(vUv + vec2(cos(angle), sin(angle)) * stepUv) * 0.1;
    }
    outColor = vec4(color, 1.0);
}`;
        this.sceneProgram = this.createProgram(VERTEX, scene);
        this.brightProgram = this.createProgram(VERTEX, bright);
        this.postProgram = this.createProgram(VERTEX, post);
        this.particleProgram = this.createProgram(PARTICLE_VERTEX, PARTICLE_FRAGMENT);
        this.resize();
    }

    createProgram(vertexSource, fragmentSource) {
        const { gl } = this;
        const shaders = [];
        const program = gl.createProgram();
        try {
            for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
                const shader = gl.createShader(type);
                shaders.push(shader);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                    throw new Error(`Void Ember WebGL2 shader: ${gl.getShaderInfoLog(shader)}`);
                }
                gl.attachShader(program, shader);
            }
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
                throw new Error(`Void Ember WebGL2 program: ${gl.getProgramInfoLog(program)}`);
            }
            const result = {
                program,
                uniforms: PARAM_NAMES.map((name) => gl.getUniformLocation(program, `params.${name}`)),
            };
            this.programs.push(result);
            return result;
        } catch (error) {
            gl.deleteProgram(program);
            throw error;
        } finally {
            shaders.forEach((shader) => gl.deleteShader(shader));
        }
    }

    createTarget(width, height) {
        const { gl } = this;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        const target = {
            texture, framebuffer, width, height,
        };
        this.targets.push(target);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            this.hdr ? gl.RGBA16F : gl.RGBA8,
            width,
            height,
            0,
            gl.RGBA,
            this.hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
            null,
        );
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('Void Ember WebGL2 render target is incomplete');
        }
        return target;
    }

    resize() {
        if (this.disposed || this.resourcesRetired || this.gl.isContextLost?.()) return;
        const width = Math.max(1, this.canvas.width);
        const height = Math.max(1, this.canvas.height);
        if (this.width === width && this.height === height) return;
        this.releaseTargets();
        this.width = width;
        this.height = height;
        this.sceneTarget = this.createTarget(width, height);
        this.bloomTarget = this.createTarget(Math.max(1, width >> 2), Math.max(1, height >> 2));
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    useProgram(program, floats) {
        const { gl } = this;
        gl.useProgram(program.program);
        program.uniforms.forEach((location, index) => {
            if (location !== null) gl.uniform4fv(location, floats.subarray(index * 4, index * 4 + 4));
        });
    }

    bindTexture(program, name, texture, slot) {
        const { gl } = this;
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(gl.getUniformLocation(program.program, name), slot);
    }

    render(floats) {
        if (this.disposed || this.resourcesRetired || this.gl.isContextLost?.()) return;
        const { gl } = this;
        this.resize();
        gl.bindVertexArray(this.vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneTarget.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        this.useProgram(this.sceneProgram, floats);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        this.useProgram(this.particleProgram, floats);
        gl.drawArrays(gl.POINTS, 0, Math.max(0, Math.floor(floats[19])));
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomTarget.framebuffer);
        gl.viewport(0, 0, this.bloomTarget.width, this.bloomTarget.height);
        this.useProgram(this.brightProgram, floats);
        this.bindTexture(this.brightProgram, 'scene_texture', this.sceneTarget.texture, 0);
        this.bindTexture(this.brightProgram, 'bloom_texture', this.sceneTarget.texture, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.width, this.height);
        this.useProgram(this.postProgram, floats);
        this.bindTexture(this.postProgram, 'scene_texture', this.sceneTarget.texture, 0);
        this.bindTexture(this.postProgram, 'bloom_texture', this.bloomTarget.texture, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    }

    releaseTargets() {
        for (const target of this.targets.splice(0)) {
            this.gl.deleteTexture(target.texture);
            this.gl.deleteFramebuffer(target.framebuffer);
        }
        this.sceneTarget = null;
        this.bloomTarget = null;
    }

    releaseResources() {
        this.releaseTargets();
        for (const entry of this.programs.splice(0)) this.gl.deleteProgram(entry.program);
        if (this.vao) this.gl.deleteVertexArray(this.vao);
        this.vao = null;
        this.sceneProgram = null;
        this.brightProgram = null;
        this.postProgram = null;
        this.particleProgram = null;
    }

    retireContextLostResources() {
        if (this.disposed || this.resourcesRetired || this.gl.isContextLost?.() !== true) return;
        // GL ignores deletion while lost. Clear the owned handles now, before
        // restore makes them invalid; keep the canvas alive for its restore event.
        this.resourcesRetired = true;
        this.releaseResources();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.releaseResources();
        this.gl.getExtension('WEBGL_lose_context')?.loseContext?.();
    }
}
