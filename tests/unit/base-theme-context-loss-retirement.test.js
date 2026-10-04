import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import {
    Mesh, MeshBasicMaterial, PlaneGeometry, Scene,
} from 'three';
import { BaseTheme } from '../../src/themes/base-theme.js';
import { gpuResilience } from '../../src/utils/gpu-context-resilience.js';

const owners = [];

class RecoveryTheme extends BaseTheme {
    constructor({ kind = 'node-gl2', completion } = {}) {
        super('loss-retirement-fixture');
        this.kind = kind;
        this.completion = completion;
        this.runtimes = [];
        owners.push(this);
    }

    async createScene() {
        const context = { lost: false, epoch: 1, invalidDeletes: 0 };
        const parent = { removeChild: vi.fn() };
        const canvas = new EventTarget();
        canvas.parentNode = parent;
        const scene = new Scene();
        const mesh = new Mesh(new PlaneGeometry(), new MeshBasicMaterial());
        scene.add(mesh);
        const handleEpoch = context.epoch;
        const deleteHandle = () => {
            if (!context.lost && handleEpoch !== context.epoch) context.invalidDeletes += 1;
        };
        mesh.geometry.addEventListener('dispose', deleteHandle);
        const renderer = {
            isWebGPURenderer: this.kind !== 'classic-gl',
            backend: this.kind === 'native' ? { isWebGPUBackend: true } : {
                isWebGLBackend: true, gl: { isContextLost: () => context.lost },
            },
            domElement: canvas,
            setAnimationLoop: vi.fn(),
            dispose: vi.fn(() => {
                // Three clears cache listeners synchronously, then awaits its
                // backend. Its scratch framebuffer references survive disposal.
                mesh.geometry.removeEventListener('dispose', deleteHandle);
                deleteHandle();
                return this.completion;
            }),
        };
        this.scene = scene;
        this.renderer = renderer;
        this.runtimes.push({
            renderer, context, parent, mesh,
        });
        this.setupRendererResilience(renderer);
    }

    stop() {
        super.stop();
        this.removeRendererResilience();
        this.scene?.traverse((object) => {
            object.geometry?.dispose();
            object.material?.dispose();
        });
        this.scene = null;
        this.disposeRenderer();
    }
}

beforeEach(() => {
    owners.length = 0;
    vi.stubGlobal('window', {
        cancelAnimationFrame: vi.fn(), removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { getElementById: () => null, querySelectorAll: () => [] });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    owners.forEach((theme) => {
        theme.stop();
        theme._contextRestoreUnsub?.();
    });
    gpuResilience.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function lose(runtime) {
    runtime.context.lost = true;
    runtime.renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
}

function restore(runtime) {
    runtime.context.lost = false;
    runtime.context.epoch += 1;
    runtime.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
}

describe('BaseTheme node WebGL2 loss retirement', () => {
    it('retires handles while lost, keeps the restore canvas, and never deletes them in the new context', async () => {
        const theme = new RecoveryTheme();
        await theme.start({ loadTheme: vi.fn() });
        const old = theme.runtimes[0];
        lose(old);
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
        expect(theme.renderer).toBe(old.renderer);
        expect(theme.isActive).toBe(true);
        expect(theme.isPaused).toBe(true);
        expect(old.parent.removeChild).not.toHaveBeenCalled();
        lose(old);
        expect(old.renderer.dispose).toHaveBeenCalledOnce();

        restore(old);
        await vi.waitFor(() => expect(theme.runtimes).toHaveLength(2));
        expect(theme.isPaused).toBe(false);
        expect(old.parent.removeChild).toHaveBeenCalledOnce();
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
        expect(old.context.invalidDeletes).toBe(0);
        expect(theme.renderer).toBe(theme.runtimes[1].renderer);
    });

    it('waits for async retirement before replacing the restored renderer', async () => {
        let finish;
        const completion = new Promise((resolve) => { finish = resolve; });
        const theme = new RecoveryTheme({ completion });
        await theme.start({ loadTheme: vi.fn() });
        const old = theme.runtimes[0];
        lose(old);
        restore(old);
        await Promise.resolve();
        expect(theme.runtimes).toHaveLength(1);
        expect(old.parent.removeChild).not.toHaveBeenCalled();
        finish();
        await vi.waitFor(() => expect(theme.runtimes).toHaveLength(2));
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
        expect(old.context.invalidDeletes).toBe(0);
    });

    it('releases lost GL2 caches immediately even with an unresolved timestamp query', async () => {
        const theme = new RecoveryTheme();
        await theme.start({ loadTheme: vi.fn() });
        const old = theme.runtimes[0];
        old.renderer.backend.trackTimestamp = true;
        old.renderer.backend.timestampQueryPool = {
            render: { pendingResolve: new Promise(() => {}) },
        };
        lose(old);
        // A native timestamp-drain delay here would move GPU deletion past a
        // fast restoration; GL2 must invoke disposal within the loss callback.
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
        restore(old);
        await vi.waitFor(() => expect(theme.runtimes).toHaveLength(2));
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
        expect(old.context.invalidDeletes).toBe(0);
    });

    it('does not revive a stopped owner when retirement settles after restoration', async () => {
        let finish;
        const completion = new Promise((resolve) => { finish = resolve; });
        const theme = new RecoveryTheme({ completion });
        await theme.start({ loadTheme: vi.fn() });
        const old = theme.runtimes[0];
        lose(old);
        restore(old);
        theme.stop();
        finish();
        await Promise.resolve();
        await Promise.resolve();
        expect(theme.runtimes).toHaveLength(1);
        expect(theme.isActive).toBe(false);
        expect(theme.renderer).toBeNull();
        expect(old.renderer.dispose).toHaveBeenCalledOnce();
    });

    it.each(['native', 'classic-gl'])('leaves %s renderer loss handling on its existing path', async (kind) => {
        const theme = new RecoveryTheme({ kind });
        await theme.start({ loadTheme: vi.fn() });
        const old = theme.runtimes[0];
        lose(old);
        expect(old.renderer.dispose).not.toHaveBeenCalled();
        expect(theme.isPaused).toBe(false);
    });

    it('does not retire a renderer belonging to an inactive theme', async () => {
        const theme = new RecoveryTheme();
        await theme.start({ loadTheme: vi.fn() });
        theme.isActive = false;
        lose(theme.runtimes[0]);
        expect(theme.runtimes[0].renderer.dispose).not.toHaveBeenCalled();
    });
});
