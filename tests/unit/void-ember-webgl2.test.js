import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { VoidEmberWebGL2Renderer } from '../../src/themes/void-ember/void-ember-webgl2.js';
import { createVoidEmberUniformData } from '../../src/themes/void-ember/void-ember-uniforms.js';
import { getVoidEmberQualityPreset } from '../../src/themes/void-ember/void-ember-presets.js';
import { StellarConductor } from '../../src/themes/void-ember/composition/stellar-conductor.js';
import { getVoidEmberAnchor } from '../../src/themes/void-ember/void-ember-composition.js';
import VoidEmberTheme from '../../src/themes/void-ember/void-ember-theme.js';

function createGL({ hdr = true, compile = true } = {}) {
    const gl = {};
    ['VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS', 'LINK_STATUS', 'TEXTURE_2D',
        'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S', 'TEXTURE_WRAP_T',
        'CLAMP_TO_EDGE', 'RGBA16F', 'RGBA8', 'RGBA', 'HALF_FLOAT', 'UNSIGNED_BYTE',
        'FRAMEBUFFER', 'COLOR_ATTACHMENT0', 'FRAMEBUFFER_COMPLETE', 'DEPTH_TEST', 'BLEND',
        'ONE', 'TRIANGLES', 'POINTS', 'TEXTURE0'].forEach((name, index) => { gl[name] = index + 1; });
    ['createVertexArray', 'createProgram', 'createShader', 'createTexture', 'createFramebuffer']
        .forEach((name) => { gl[name] = vi.fn(() => ({})); });
    ['deleteVertexArray', 'deleteProgram', 'deleteShader', 'deleteTexture', 'deleteFramebuffer',
        'shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'bindTexture',
        'texParameteri', 'texImage2D', 'bindFramebuffer', 'framebufferTexture2D', 'useProgram',
        'uniform4fv', 'activeTexture', 'uniform1i', 'bindVertexArray', 'disable', 'enable',
        'viewport', 'drawArrays', 'blendFunc'].forEach((name) => { gl[name] = vi.fn(); });
    gl.loseContext = vi.fn();
    gl.getExtension = vi.fn((name) => {
        if (name === 'WEBGL_lose_context') return { loseContext: gl.loseContext };
        return hdr ? {} : null;
    });
    gl.getShaderParameter = vi.fn(() => compile);
    gl.isContextLost = vi.fn(() => false);
    gl.getShaderInfoLog = () => 'Shader rejected';
    gl.getProgramParameter = vi.fn(() => true);
    gl.getUniformLocation = (_program, name) => name;
    gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
    return gl;
}
function uniformData(tier = 'low') {
    const conductor = new StellarConductor();
    conductor.onLineClear(4);
    return createVoidEmberUniformData({
        canvas: { width: 390, height: 844 },
        runtime: {
            time: 8,
            delta: 1 / 60,
            pulse: 0.2,
            collapse: 0,
            eventEnergy: 0.4,
            comboEnergy: 0.5,
            turbulence: 0.22,
            lineEnergy: 0.8,
            shockwave: 0.6,
            flare: 0.7,
            hardDropFlash: 0.1,
            intensity: 0.4,
        },
        frameCounter: 480,
        qualityPreset: getVoidEmberQualityPreset(tier),
        currentTier: tier,
        anchor: { x: 0.6, y: 0.7 },
        colors: { core: [7.2, 1.15, 0.16], outer: [1.8, 0.24, 0.05] },
        conductor,
    });
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Void Ember WebGL2 compatibility', () => {
    it('returns no renderer only when WebGL2 is unavailable', () => {
        const canvas = { getContext: vi.fn(() => null) };
        expect(VoidEmberWebGL2Renderer.create(canvas)).toBeNull();
        expect(canvas.getContext).toHaveBeenCalledWith('webgl2', expect.objectContaining({ alpha: false }));
    });

    it('releases partially built shader resources on compilation failure', () => {
        const gl = createGL({ compile: false });
        const canvas = { getContext: () => gl, width: 390, height: 844 };
        expect(() => VoidEmberWebGL2Renderer.create(canvas)).toThrow('Shader rejected');
        expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
        expect(gl.deleteShader).toHaveBeenCalledTimes(1);
        expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    });

    it.each([true, false])('renders current scene and bounded sparks with HDR support=%s', (hdr) => {
        const gl = createGL({ hdr });
        const canvas = { getContext: () => gl, width: 390, height: 844 };
        const renderer = VoidEmberWebGL2Renderer.create(canvas);
        const data = uniformData();
        renderer.render(data);
        expect(renderer.hdr).toBe(hdr);
        expect(gl.texImage2D.mock.calls[0][2]).toBe(hdr ? gl.RGBA16F : gl.RGBA8);
        expect(gl.drawArrays).toHaveBeenCalledWith(gl.POINTS, 0, 90);
        expect(gl.drawArrays).toHaveBeenCalledTimes(4);
        expect(gl.uniform4fv).toHaveBeenCalledWith('params.star0', data.subarray(40, 44));
        canvas.width = 844;
        canvas.height = 390;
        renderer.resize();
        expect(renderer.sceneTarget.width).toBe(844);
        expect(renderer.bloomTarget.width).toBe(211);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
        renderer.dispose();
        expect(gl.deleteTexture).toHaveBeenCalledTimes(4);
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(4);
        expect(gl.deleteProgram).toHaveBeenCalledTimes(4);
        expect(gl.loseContext).toHaveBeenCalledTimes(1);
        renderer.dispose();
        expect(gl.loseContext).toHaveBeenCalledTimes(1);
    });

    it('packs the native uniform layout, conductor life-state and shared quality parameters', () => {
        const low = uniformData();
        const high = uniformData('high');
        expect(low).toHaveLength(48);
        expect(low.every(Number.isFinite)).toBe(true);
        expect(low[6]).toBeCloseTo(390 / 844);
        expect(low[8]).toBeCloseTo(0.6);
        expect(low[9]).toBeCloseTo(0.7);
        expect(low[19]).toBe(90);
        expect(high[19]).toBe(240);
        expect(low[23]).toBe(0);
        expect(high[23]).toBeCloseTo(getVoidEmberQualityPreset('high').temporalMix);
        expect(low[40]).toBeGreaterThan(0.12);
        expect(low[44]).toBeCloseTo(0.9);
    });

    it('retires lost-context resources before restore and never reuses or deletes stale handles', () => {
        const gl = createGL();
        const canvas = { getContext: () => gl, width: 390, height: 844 };
        const renderer = VoidEmberWebGL2Renderer.create(canvas);
        renderer.retireContextLostResources();
        expect(renderer.programs).toHaveLength(4);

        let lost = true;
        gl.isContextLost.mockImplementation(() => lost);
        const deletionStates = [];
        ['deleteTexture', 'deleteFramebuffer', 'deleteProgram', 'deleteVertexArray'].forEach((name) => {
            gl[name].mockImplementation(() => { deletionStates.push(gl.isContextLost()); });
        });
        renderer.retireContextLostResources();
        expect(deletionStates).toEqual(Array(9).fill(true));
        expect(renderer.programs).toHaveLength(0);
        expect(renderer.targets).toHaveLength(0);
        expect(renderer.vao).toBeNull();
        expect(gl.loseContext).not.toHaveBeenCalled();

        canvas.width = 844;
        renderer.render(uniformData());
        renderer.resize();
        lost = false;
        renderer.render(uniformData());
        renderer.resize();
        renderer.dispose();
        renderer.dispose();
        expect(gl.drawArrays).not.toHaveBeenCalled();
        expect(gl.createTexture).toHaveBeenCalledTimes(2);
        expect(deletionStates).toEqual(Array(9).fill(true));
    });
});

describe('Void Ember theme compatibility routing', () => {
    function createOwner() {
        const theme = Object.create(VoidEmberTheme.prototype);
        theme.canvas = {};
        theme.replaceCanvas = vi.fn(() => { theme.canvas = { fresh: true }; });
        theme.resizeCanvas = vi.fn();
        theme.setupRendererResilience = vi.fn();
        theme.removeRendererResilience = vi.fn();
        theme.init2DFallback = vi.fn(() => { theme.renderBackend = 'canvas2d'; });
        return theme;
    }

    it('uses the modern compatible scene before considering Canvas2D', () => {
        const compatible = { dispose: vi.fn() };
        vi.spyOn(VoidEmberWebGL2Renderer, 'create').mockReturnValue(compatible);
        const theme = createOwner();
        theme.initCompatibleFallback({});
        expect(theme.renderBackend).toBe('webgl2');
        expect(theme.webgl2).toBe(compatible);
        expect(theme.init2DFallback).not.toHaveBeenCalled();
        expect(theme.setupRendererResilience).toHaveBeenCalledWith(
            { domElement: theme.canvas },
            expect.objectContaining({ onContextRestored: expect.any(Function) }),
        );
        theme.teardownRuntime();
        expect(compatible.dispose).toHaveBeenCalledTimes(1);
        expect(theme.webgl2).toBeNull();
        expect(theme.renderBackend).toBe('none');
    });

    it('keeps the lost canvas and monitor until restore rebuilds the compatible renderer', () => {
        const compatible = { dispose: vi.fn(), retireContextLostResources: vi.fn() };
        vi.spyOn(VoidEmberWebGL2Renderer, 'create').mockReturnValue(compatible);
        const theme = createOwner();
        theme.scheduleRebuild = vi.fn();
        theme.initCompatibleFallback({});
        const { canvas } = theme;
        const { onContextLost, onContextRestored } = theme.setupRendererResilience.mock.calls[0][1];
        onContextLost();
        expect(compatible.retireContextLostResources).toHaveBeenCalledTimes(1);
        expect(compatible.dispose).not.toHaveBeenCalled();
        expect(theme.removeRendererResilience).not.toHaveBeenCalled();
        expect(theme.webgl2).toBe(compatible);
        expect(theme.canvas).toBe(canvas);
        onContextRestored();
        expect(theme.scheduleRebuild).toHaveBeenCalledWith('webgl2-context-restored');
        theme.teardownRuntime();
        onContextLost();
        onContextRestored();
        expect(compatible.retireContextLostResources).toHaveBeenCalledTimes(1);
        expect(theme.scheduleRebuild).toHaveBeenCalledTimes(1);
    });

    it.each([null, new Error('GL compiler failed')])('replaces a failed GL canvas: %s', (result) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(VoidEmberWebGL2Renderer, 'create').mockImplementation(() => {
            if (result instanceof Error) throw result;
            return result;
        });
        const theme = createOwner();
        const container = {};
        theme.initCompatibleFallback(container);
        expect(theme.replaceCanvas).toHaveBeenCalledWith(container);
        expect(theme.resizeCanvas).toHaveBeenCalledTimes(1);
        expect(theme.init2DFallback).toHaveBeenCalledTimes(1);
        expect(theme.renderBackend).toBe('canvas2d');
    });

    it('honors the forced compatibility flag before requesting a native adapter', async () => {
        vi.stubGlobal('window', { location: { search: '?forceWebGL=1' } });
        const requestAdapter = vi.fn();
        vi.stubGlobal('navigator', { gpu: { requestAdapter } });
        const theme = createOwner();
        expect(await theme.initWebGPU(1)).toBe(false);
        expect(requestAdapter).not.toHaveBeenCalled();
    });
});

describe('Void Ember portrait framing', () => {
    it('preserves the native authored desktop orbit', () => {
        const time = 8;
        const anchor = getVoidEmberAnchor(time, 16 / 9);
        const x = 0.5 + Math.sin(time * 0.067) * 0.38 + Math.sin(time * 0.031 + 1.7) * 0.12;
        const y = 0.5 + Math.sin(time * 0.053 + 0.8) * 0.38 + Math.cos(time * 0.041 + 2.3) * 0.12;
        expect(anchor.x).toBeCloseTo(x);
        expect(anchor.y).toBeCloseTo(y);
    });

    it('keeps the breathing disc within a phone viewport across the full orbit', () => {
        const aspect = 390 / 844;
        for (let time = 0; time <= 360; time += 0.5) {
            const anchor = getVoidEmberAnchor(time, aspect);
            expect(anchor.x - 0.17 / aspect).toBeGreaterThanOrEqual(-1e-8);
            expect(anchor.x + 0.17 / aspect).toBeLessThanOrEqual(1 + 1e-8);
            expect(anchor.y).toBeGreaterThanOrEqual(0.17);
            expect(anchor.y).toBeLessThanOrEqual(0.83);
        }
    });
});
