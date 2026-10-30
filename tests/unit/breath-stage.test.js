import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { looseNode, looseWindow } from './helpers/loose-dom.js';

const STAGE_MODULE = '../../src/ui/effects/breathing/stage/breath-stage.js';

let BreathStage;
let hosts;
let frames;
let doc;
let webgpu;

beforeEach(async () => {
    vi.resetModules();
    hosts = [];
    frames = new Map();
    webgpu = true;
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    doc = looseNode();
    Object.defineProperty(doc, 'hidden', { get: () => false });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', looseWindow({ devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }));
    vi.stubGlobal('navigator', { gpu: {} });
    vi.doMock('three/webgpu', () => ({
        WebGPURenderer: class {
            constructor() {
                this.domElement = looseNode('canvas');
                this.backend = { isWebGPUBackend: webgpu, device: { lost: new Promise(() => {}) } };
            }

            init() { return Promise.resolve(); }

            setPixelRatio() {}

            setSize() {}

            dispose() {}
        },
        Scene: class {},
        PerspectiveCamera: class {},
        NoToneMapping: 0,
        SRGBColorSpace: 'srgb',
    }));
    vi.doMock('../../src/rendering/async-render-pipelines.js', () => ({
        beginAsyncRenderPipelines: () => ({ settle: () => Promise.resolve(), end: () => {} }),
        preloadAsyncRenderPipelines: () => Promise.resolve(),
    }));
    vi.doMock('../../src/ui/effects/breathing/stage/breath-world-host.js', () => ({
        BREATH_QUALITY: { High: { pixelRatio: 1.5, maxPixels: 2.4e6, frameInterval: 0 } },
        BreathWorldHost: class {
            constructor() {
                this.worldId = null;
                this.renders = 0;
                hosts.push(this);
            }

            setWorld(id) { this.worldId = id; return id; }

            setReducedMotion() {}

            setFocus() {}

            setSessionPhase() {}

            setBreath() {}

            setSize() {}

            step() {}

            render() { this.renders += 1; }

            getDiagnostics() { return {}; }

            dispose() {}
        },
    }));
    ({ BreathStage } = await import(STAGE_MODULE));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('three/webgpu');
    vi.doUnmock('../../src/rendering/async-render-pipelines.js');
    vi.doUnmock('../../src/ui/effects/breathing/stage/breath-world-host.js');
});

describe('breath stage', () => {
    it('shows its first world once its pipelines are settled', async () => {
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        stage.setWorld('zen-garden');
        await stage.start();
        expect(states).toEqual(['veiled', 'ready']);
        expect(hosts[0].worldId).toBe('zen-garden');
        stage.dispose();
    });

    it('says its world is ready again when restarted on the world it already shows', async () => {
        // The guide drops its live mark when a practice ends (or goes over the theme); a parked
        // stage started again on the same world compiles nothing, but must still be shown.
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        stage.setWorld('zen-garden');
        await stage.start();
        stage.stop();
        states.length = 0;
        const rendersBefore = hosts[0].renders;
        stage.setWorld('zen-garden');
        await stage.start();
        expect(states).toEqual(['ready']);
        // A fresh frame is drawn before the canvas is shown again.
        expect(hosts[0].renders).toBeGreaterThan(rendersBefore);
        stage.dispose();
    });

    it('swaps (and reports it) when restarted on another world', async () => {
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        stage.setWorld('zen-garden');
        await stage.start();
        stage.stop();
        states.length = 0;
        stage.setWorld('calm-sleep');
        await stage.start();
        expect(states).toEqual(['veiled', 'ready']);
        expect(hosts[0].worldId).toBe('calm-sleep');
        stage.dispose();
    });

    it('prepares a world behind the closed guide without running a frame loop', async () => {
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        await stage.prepare('calm-sleep');
        expect(hosts[0].worldId).toBe('calm-sleep');
        expect(states).toEqual(['veiled', 'ready']);
        expect(frames.size).toBe(0);
        // Starting on it swaps nothing: it says it is ready and the frame loop begins.
        states.length = 0;
        stage.setWorld('calm-sleep');
        await stage.start();
        expect(states).toEqual(['ready']);
        expect(frames.size).toBe(1);
        stage.dispose();
    });

    it('leaves the swap to a start that comes while it prepares', async () => {
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        const preparing = stage.prepare('calm-sleep');
        stage.setWorld('ocean-breath');
        await Promise.all([preparing, stage.start()]);
        expect(hosts[0].worldId).toBe('ocean-breath');
        expect(states).toEqual(['veiled', 'ready']);
        stage.dispose();
    });

    it('only starts the renderer when it would compile synchronously (WebGL2)', async () => {
        webgpu = false;
        const states = [];
        const stage = new BreathStage(looseNode(), { onState: (state) => states.push(state) });
        await stage.prepare('calm-sleep');
        expect(stage.backend).toBe('webgl2');
        expect(hosts[0].worldId).toBeNull();
        expect(states).toEqual([]);
        stage.dispose();
    });

    it('stops drawing once stopped and cancels its frame on dispose', async () => {
        const stage = new BreathStage(looseNode());
        stage.setWorld('zen-garden');
        await stage.start();
        expect(frames.size).toBe(1);
        stage.stop();
        expect(frames.size).toBe(0);
        await stage.start();
        expect(frames.size).toBe(1);
        stage.dispose();
        expect(frames.size).toBe(0);
        expect(doc.listenerCount('visibilitychange')).toBe(0);
    });
});
