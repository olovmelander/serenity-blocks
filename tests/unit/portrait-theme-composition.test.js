import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import * as THREE from 'three';
import SunsetTheme from '../../src/themes/sunset/sunset-theme.js';
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

function createSunset(aspect) {
    const theme = new SunsetTheme();
    theme.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 30000);
    theme.camera.position.copy(theme.baseCameraPos);
    theme.camera.lookAt(0, 0, 0);
    theme.camera.updateMatrixWorld();
    return theme;
}

function projectedCoreEdges(position, camera) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(8);
    return [-1, 1].map((side) => position.clone().addScaledVector(right, side).project(camera).x);
}

describe('Sunset portrait celestial composition', () => {
    it.each([['Low', 3000], ['Minimal', 1000], ['High', 15000], ['Extreme', 35000]])(
        'allocates the authored %s star budget of %s without a hidden 35000 minimum',
        (quality, count) => {
            const theme = createSunset(390 / 844);
            theme.mainGroup = new THREE.Group();
            theme.applyQualityPreset(quality);
            theme.createStars();
            expect(theme.stars.geometry.getAttribute('position').count).toBe(count);
            expect(theme.stars.geometry.getAttribute('aTwinkle').count).toBe(count);
            theme.stars.geometry.dispose();
            theme.stars.material.dispose();
        },
    );

    it('keeps the existing 35000 fallback when a preset omits its budget', () => {
        const theme = createSunset(390 / 844);
        theme.mainGroup = new THREE.Group();
        theme.activePreset = {};
        theme.createStars();
        expect(theme.stars.geometry.getAttribute('position').count).toBe(35000);
        theme.stars.geometry.dispose();
        theme.stars.material.dispose();
    });

    it.each([390 / 844, 320 / 900, 600 / 900])('keeps sun and moon cores within aspect %s while the camera drifts', (aspect) => {
        const theme = createSunset(aspect);
        for (const elapsed of [0, 45, 150]) {
            theme.pointerX = 1;
            theme.pointerY = -1;
            theme.updateCameraDrift(elapsed, 0.1);
            for (const progress of [0, 0.05, 0.25, 0.35, 0.55, 0.65, 0.75, 0.95]) {
                theme.dayProgress = progress;
                theme.updateSunPosition();
                for (const position of [theme.sunPosition, theme.moonPosition]) {
                    const edges = projectedCoreEdges(position, theme.camera);
                    expect(Math.min(...edges)).toBeGreaterThan(-1);
                    expect(Math.max(...edges)).toBeLessThan(1);
                }
            }
        }
    });

    it.each([1, 844 / 390, 16 / 9])('preserves the authored landscape arc at aspect %s', (aspect) => {
        const theme = createSunset(aspect);
        theme.updateCameraDrift(45, 0.1);
        for (const progress of [0, 0.25, 0.55, 0.75, 1]) {
            theme.dayProgress = progress;
            theme.updateSunPosition();
            const angle = progress * Math.PI * 2 - Math.PI * 0.5;
            const moonAngle = (progress + 0.5) * Math.PI * 2 - Math.PI * 0.5;
            expect(theme.sunPosition.toArray()).toEqual([Math.cos(angle) * 200, Math.sin(angle) * 70 - 15, -100]);
            expect(theme.moonPosition.toArray()).toEqual([Math.cos(moonAngle) * 240, Math.sin(moonAngle) * 75 - 25, -120]);
        }
    });

    it('reframes immediately when rotating back into portrait', () => {
        const theme = createSunset(844 / 390);
        theme.renderer = { setSize: vi.fn() };
        theme.updateSunPosition();
        expect(Math.abs(theme.sunPosition.clone().project(theme.camera).x)).toBeLessThan(1);
        theme.onWindowResize();
        expect(theme.camera.aspect).toBe(390 / 844);
        expect(projectedCoreEdges(theme.sunPosition, theme.camera).every((x) => Math.abs(x) < 1)).toBe(true);
        expect(theme.renderer.setSize).toHaveBeenCalledWith(390, 844);
    });
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
