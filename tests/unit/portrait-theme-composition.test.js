import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import RainyWindowTheme from '../../src/themes/rainy-window/rainy-window-theme.js';

const rendererState = vi.hoisted(() => ({ instances: [], makeCanvas: null }));
vi.mock('three', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        WebGLRenderer: class {
            constructor() {
                this.domElement = rendererState.makeCanvas();
                this.setSize = vi.fn();
                this.setPixelRatio = vi.fn();
                this.dispose = vi.fn();
                this.forceContextLoss = vi.fn();
                rendererState.instances.push(this);
            }
        },
    };
});

function makeNode(id = '') {
    const node = {
        id,
        children: [],
        parentNode: null,
        dataset: { themeRegistryOwned: 'true' },
        style: { removeProperty: vi.fn() },
        classList: { remove: vi.fn() },
        appendChild(child) {
            child.parentNode?.removeChild(child);
            this.children.push(child);
            child.parentNode = this;
        },
        removeChild(child) {
            this.children = this.children.filter((item) => item !== child);
            child.parentNode = null;
        },
    };
    Object.defineProperty(node, 'innerHTML', {
        set() {
            this.children.forEach((child) => { child.parentNode = null; });
            this.children = [];
        },
    });
    return node;
}

let body;
let container;
let listeners;
beforeEach(() => {
    rendererState.instances = [];
    rendererState.makeCanvas = () => makeNode();
    body = makeNode('body');
    container = makeNode('rainy-window-theme');
    body.appendChild(container);
    container.appendChild(makeNode('legacy-rain-background'));
    listeners = new Map();
    vi.stubGlobal('window', {
        innerWidth: 390,
        innerHeight: 844,
        devicePixelRatio: 1,
        settings: { targetFrameRate: 30 },
        location: { search: '' },
        addEventListener: (event, fn) => listeners.set(fn, event),
        removeEventListener: (event, fn) => listeners.delete(fn),
    });
    vi.stubGlobal('document', {
        body,
        getElementById: (id) => {
            const find = (node) => (node.id === id ? node : node.children.map(find).find(Boolean));
            return find(body);
        },
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Rainy Window canvas ownership', () => {
    it('replaces opaque legacy scenery inside the active theme instead of mounting under it', () => {
        const theme = new RainyWindowTheme();
        theme.initThreeJS();
        expect(body.children).toEqual([container]);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(theme.renderer.domElement.style.position).toBe('absolute');
        expect(theme.renderer.domElement.style.zIndex).toBe('1');
    });

    it('retires the mounted canvas and resize listener before restarting with one new canvas', () => {
        const theme = new RainyWindowTheme();
        theme.initThreeJS();
        const first = theme.renderer;
        expect(listeners.size).toBe(1);
        theme.stop();
        expect(first.dispose).toHaveBeenCalledOnce();
        expect(first.domElement.parentNode).toBeNull();
        expect(container.children).toHaveLength(0);
        expect(listeners.size).toBe(0);
        theme.initThreeJS();
        expect(theme.renderer).not.toBe(first);
        expect(body.children).toEqual([container]);
        expect(container.children).toEqual([theme.renderer.domElement]);
        expect(listeners.size).toBe(1);
        theme.stop();
        theme.stop();
        expect(rendererState.instances.every((renderer) => renderer.dispose.mock.calls.length === 1)).toBe(true);
        expect(container.children).toHaveLength(0);
        expect(listeners.size).toBe(0);
    });

    it('fails before allocating a renderer when its registry container is missing', () => {
        body.removeChild(container);
        const theme = new RainyWindowTheme();
        expect(() => theme.initThreeJS()).toThrow('Theme container not found');
        expect(rendererState.instances).toHaveLength(0);
        expect(body.children).toHaveLength(0);
    });
});
