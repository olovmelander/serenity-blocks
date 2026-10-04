import { readFileSync } from 'node:fs';
import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import StellarDriftTheme from '../../src/themes/stellar-drift/stellar-drift-theme.js';
import StellarVelocityTheme from '../../src/themes/stellar-velocity/stellar-velocity-theme.js';
import { gpuResilience } from '../../src/utils/gpu-context-resilience.js';
import { eventBus, EVENTS } from '../../src/events/event-bus.js';

// SB-15 WebGPU-lane leak regression (dominant leak, ~2.9 MB/toggle before fix).
//
// three's WebGPUBackend already wires `device.lost.then()` -> `renderer.onDeviceLost`
// (three/src/renderers/webgpu/WebGPUBackend.js), and stellar-drift replaces
// renderer.onDeviceLost with a closure-free no-op on teardown, so recovery is covered by
// onDeviceLost alone. An ADDITIONAL app-side `device.lost.then(() => this.handleDeviceLoss())`
// used to be registered in setupRendererResilience — but a .then() reaction cannot be
// detached and device.lost never settles under normal play, so its closure pinned the
// whole theme instance (scene included) on the never-resolving promise for every theme
// activation. Heap snapshots convicted it as the dominant SB-15 WebGPU-lane leak;
// removing it cut the per-toggle growth by ~93% (software-WebGPU A/B, 10 toggles:
// +29.3 MB -> +2.1 MB). These contract checks keep it from creeping back.

const source = readFileSync(
    new URL('../../src/themes/stellar-drift/stellar-drift-theme.js', import.meta.url),
    'utf8',
);

// Anchor on the method DEFINITION (4-space class indent), not call sites or prose
// mentions in comments (which include the tokens we assert against below).
function methodBody(name) {
    const match = source.match(new RegExp(`\\n {4}${name}\\s*\\(`));
    expect(match, `method ${name} not found`).not.toBeNull();
    return source.slice(match.index, match.index + 2500);
}

const stripComments = (s) => s
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

describe('stellar-drift WebGPU device-loss handling (SB-15 leak regression)', () => {
    it('still routes device loss through renderer.onDeviceLost (recovery preserved)', () => {
        const body = methodBody('setupRendererResilience');
        expect(body).toMatch(/this\.renderer\.onDeviceLost\s*=/);
        expect(body).toContain('handleDeviceLoss');
    });

    it('does NOT register a raw device.lost.then() (the leak); relies on onDeviceLost only', () => {
        // Strip comments so the explanatory note (which names the removed pattern) does
        // not trip the guard — we are asserting the CODE no longer registers it.
        const code = stripComments(methodBody('setupRendererResilience'));
        expect(code).not.toMatch(/device\??\.lost/);
        expect(code).not.toMatch(/deviceLostPromise/);
        expect(code).not.toMatch(/\.lost\s*\.\s*then/);
    });

    it('leaves a callable callback without a theme closure after teardown', () => {
        const body = methodBody('disposeRendererResources');
        expect(body).toMatch(/this\.renderer\.onDeviceLost\s*=\s*\(\)\s*=>\s*\{\s*\}/);
    });
});

afterEach(() => {
    gpuResilience.cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe.each([
    ['Stellar Drift', StellarDriftTheme],
    ['Stellar Velocity', StellarVelocityTheme],
])('%s callable device-loss lifecycle', (_name, Theme) => {
    function createTheme(isWebGL) {
        const theme = new Theme();
        theme.isActive = true;
        theme.isWebGL = isWebGL;
        theme.isWebGPU = !isWebGL;
        const defaultCallback = function markLost() { this._isDeviceLost = true; };
        const canvas = new EventTarget();
        canvas.style = {};
        const renderer = {
            onDeviceLost: defaultCallback,
            domElement: canvas,
            isWebGPURenderer: true,
            backend: {
                isWebGLBackend: isWebGL,
                gl: { isContextLost: () => renderer.contextLost === true },
            },
            dispose: vi.fn(),
        };
        if (isWebGL) {
            canvas.addEventListener('webglcontextlost', () => renderer.onDeviceLost({ api: 'WebGL' }));
        }
        theme.renderer = renderer;
        vi.spyOn(theme, 'handleDeviceLoss').mockResolvedValue();
        return { theme, renderer, defaultCallback };
    }

    it('preserves the live WebGL2 constructor callback that stops a lost renderer', () => {
        const { theme, renderer, defaultCallback } = createTheme(true);
        theme.setupRendererResilience();
        expect(renderer.onDeviceLost).toBe(defaultCallback);
        renderer.onDeviceLost({ api: 'WebGL' });
        expect(renderer._isDeviceLost).toBe(true);
        expect(theme.handleDeviceLoss).not.toHaveBeenCalled();
    });

    it('marks a live native renderer lost and keeps current-generation recovery', () => {
        const { theme, renderer } = createTheme(false);
        theme.setupRendererResilience();
        const info = { api: 'WebGPU', message: 'device lost' };
        renderer.onDeviceLost(info);
        expect(renderer._isDeviceLost).toBe(true);
        expect(theme.handleDeviceLoss).toHaveBeenCalledWith(info);
    });

    it.each([true, false])('releases the theme closure and tolerates a backend loss callback during teardown (WebGL=%s)', (isWebGL) => {
        const { theme, renderer } = createTheme(isWebGL);
        theme.setupRendererResilience();
        const oldCallback = renderer.onDeviceLost;
        vi.spyOn(theme, 'disposeRenderer').mockImplementation(() => {
            expect(() => renderer.onDeviceLost({ api: isWebGL ? 'WebGL' : 'WebGPU' })).not.toThrow();
        });
        theme.disposeRendererResources();
        expect(theme.renderer).toBeNull();
        expect(renderer.onDeviceLost).not.toBe(oldCallback);
        expect(renderer.onDeviceLost.toString()).toMatch(/\(\)\s*=>\s*\{\s*\}/);
        expect(() => renderer.onDeviceLost({ api: 'WebGL' })).not.toThrow();
        oldCallback.call(renderer, { api: 'WebGPU' });
        expect(theme.handleDeviceLoss).not.toHaveBeenCalled();
    });

    it('retires the lost node renderer before real canvas restore requests a rebuild and stops listening after stop', async () => {
        vi.stubGlobal('window', {
            location: { search: '' }, settings: {},
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
        });
        vi.stubGlobal('document', { getElementById: () => null, querySelectorAll: () => [] });
        const { theme, renderer } = createTheme(true);
        theme.isActive = false;
        const shared = { loadTheme: vi.fn() };
        vi.spyOn(theme, 'createScene').mockImplementation(async () => {
            theme.renderer = renderer;
            theme.setupRendererResilience();
        });
        await theme.start(shared);
        const start = vi.spyOn(theme, 'start').mockResolvedValue();
        const restore = vi.fn();
        const unsubscribe = eventBus.on(EVENTS.CONTEXT_RESTORED, restore);
        try {
            theme.setupRendererResilience();
            renderer.contextLost = true;
            const loss = new Event('webglcontextlost', { cancelable: true });
            renderer.domElement.dispatchEvent(loss);
            expect(loss.defaultPrevented).toBe(true);
            expect(renderer._isDeviceLost).toBe(true);
            expect(renderer.dispose).toHaveBeenCalledOnce();
            expect(theme.isPaused).toBe(true);

            renderer.contextLost = false;
            renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
            expect(restore).toHaveBeenCalledOnce();
            expect(restore).toHaveBeenCalledWith(expect.objectContaining({ canvas: renderer.domElement, label: theme.name }));
            expect(start).toHaveBeenCalledOnce();
            expect(start).toHaveBeenCalledWith(shared, expect.any(Object));

            theme.stop();
            renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
            expect(restore).toHaveBeenCalledOnce();
            expect(start).toHaveBeenCalledOnce();
        } finally {
            unsubscribe();
            theme._contextRestoreUnsub?.();
            theme._contextRestoreUnsub = null;
        }
    });
});
