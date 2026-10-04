import {
    describe, expect, it, vi,
} from 'vitest';
import FluidSimulator from '../../src/utils/webgl/fluid-simulator.js';

function makeSimulator() {
    const simulator = new FluidSimulator({ width: 390, height: 844 }, { BLOOM_ITERATIONS: 3 });
    let nextId = 0;
    const liveTextures = new Set();
    const liveFramebuffers = new Set();
    simulator.gl = {
        LINEAR: 1,
        NEAREST: 2,
        BLEND: 3,
        disable: vi.fn(),
        uniform1i: vi.fn(),
        deleteTexture: vi.fn((id) => liveTextures.delete(id)),
        deleteFramebuffer: vi.fn((id) => liveFramebuffers.delete(id)),
    };
    simulator.ext = {
        halfFloatTexType: 4,
        supportLinearFiltering: true,
        formatRGBA: { internalFormat: 5, format: 6 },
        formatRG: { internalFormat: 7, format: 8 },
        formatR: { internalFormat: 9, format: 10 },
    };
    simulator.createFBO = vi.fn((width, height) => {
        const id = ++nextId;
        liveTextures.add(id); liveFramebuffers.add(id);
        return {
            texture: id,
            fbo: id,
            width,
            height,
            texelSizeX: 1 / width,
            texelSizeY: 1 / height,
            attach: () => id,
        };
    });
    simulator.programs.copy = { bind: vi.fn(), uniforms: { uTexture: 11 } };
    simulator.materials.display = { setKeywords: vi.fn() };
    simulator.blit = vi.fn();
    return { simulator, liveTextures, liveFramebuffers };
}

describe('fluid targets across phone rotation and browser-bar resizing', () => {
    it('reuses unchanged target sizes and retires every replaced texture/framebuffer', () => {
        const { simulator, liveTextures, liveFramebuffers } = makeSimulator();
        simulator.initFramebuffers();
        const initialCount = liveTextures.size;
        const initialAllocations = simulator.createFBO.mock.calls.length;
        simulator.initFramebuffers();
        expect(simulator.createFBO).toHaveBeenCalledTimes(initialAllocations);
        for (const [width, height] of [[844, 390], [390, 780], [390, 844], [844, 390], [390, 844]]) {
            simulator.resize(width, height);
            expect(liveTextures.size).toBe(initialCount);
            expect(liveFramebuffers.size).toBe(initialCount);
        }
        expect(simulator.blit).toHaveBeenCalled(); // dye/velocity survive resize
        simulator.cleanup();
        expect(liveTextures.size).toBe(0);
        expect(liveFramebuffers.size).toBe(0);
    });

    it('retires unused bloom mips when the quality configuration shrinks', () => {
        const { simulator, liveTextures } = makeSimulator();
        simulator.initFramebuffers();
        const before = liveTextures.size;
        simulator.config.BLOOM_ITERATIONS = 1;
        simulator.initFramebuffers();
        expect(simulator.bloomFramebuffers).toHaveLength(1);
        expect(liveTextures.size).toBe(before - 2);
    });

    it('reports missing context or renderable float formats before shader/FBO setup', () => {
        const simulator = new FluidSimulator({ getContext: () => null });
        expect(() => simulator.getWebGLContext(simulator.canvas)).toThrow('WebGL context');
        const gl = { getExtension: vi.fn(), clearColor: vi.fn(), HALF_FLOAT: 1 };
        simulator.getSupportedFormat = () => null;
        expect(() => simulator.getWebGLContext({ getContext: () => gl })).toThrow('renderable half-float');
    });

    it('releases both successful and failed format probes', () => {
        const simulator = new FluidSimulator({});
        const gl = {
            createTexture: () => 1,
            createFramebuffer: () => 2,
            bindTexture: vi.fn(),
            texParameteri: vi.fn(),
            texImage2D: vi.fn(),
            bindFramebuffer: vi.fn(),
            framebufferTexture2D: vi.fn(),
            checkFramebufferStatus: vi.fn(),
            deleteTexture: vi.fn(),
            deleteFramebuffer: vi.fn(),
            FRAMEBUFFER_COMPLETE: 3,
        };
        gl.checkFramebufferStatus.mockReturnValueOnce(3).mockReturnValueOnce(4);
        expect(simulator.supportRenderTextureFormat(gl, 5, 6, 7)).toBe(true);
        expect(simulator.supportRenderTextureFormat(gl, 5, 6, 7)).toBe(false);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(2);
    });

    it('keeps half-float filtering on WebGL2 without the optional float32 extension', () => {
        const simulator = new FluidSimulator({});
        const gl = { getExtension: vi.fn(() => null), clearColor: vi.fn(), HALF_FLOAT: 1 };
        simulator.getSupportedFormat = (context, internalFormat, format) => ({ internalFormat, format });
        const { ext } = simulator.getWebGLContext({ getContext: () => gl });
        expect(ext.halfFloatTexType).toBe(gl.HALF_FLOAT);
        expect(ext.supportLinearFiltering).toBe(true);
        expect(gl.getExtension).toHaveBeenCalledWith('EXT_color_buffer_half_float');
        expect(gl.getExtension).not.toHaveBeenCalledWith('OES_texture_float_linear');
    });
});
