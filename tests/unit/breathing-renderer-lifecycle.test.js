import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

// Keep real Three.js scene/geometry/material objects. Only the browser GL adapter
// is replaced; shader compatibility is exercised by the browser capture harness.
vi.mock('three', async (importOriginal) => {
    const three = await importOriginal();
    class RendererAdapter {
        constructor() {
            this.domElement = { className: '', setAttribute: vi.fn(), remove: vi.fn(),
                addEventListener: vi.fn(), removeEventListener: vi.fn() };
            this.setClearColor = vi.fn();
            this.setSize = vi.fn();
            this.setPixelRatio = vi.fn();
            this.render = vi.fn();
            this.dispose = vi.fn();
            this.forceContextLoss = vi.fn();
        }
    }
    return { ...three, WebGLRenderer: RendererAdapter };
});

import { ThreeJSBreathingRenderer } from '../../src/ui/effects/threejs-breathing-renderer.js';
import { BREATHING_VISUAL_PROFILES } from '../../src/ui/effects/breathing-atmosphere.js';

let renderer;
let container;
let frames;
let listeners;
let mediaQueries;
let observer;
let hidden;

function advanceFrame(time) {
    const next = frames.entries().next().value;
    expect(next).toBeDefined();
    const [id, callback] = next;
    frames.delete(id);
    callback(time);
}

beforeEach(() => {
    frames = new Map();
    listeners = new Map();
    mediaQueries = new Map();
    hidden = false;
    let nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
        const id = nextFrame++;
        frames.set(id, callback);
        return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => frames.delete(id)));
    vi.stubGlobal('window', {
        devicePixelRatio: 3,
        matchMedia(query) {
            if (!mediaQueries.has(query)) mediaQueries.set(query, {
                matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
            });
            return mediaQueries.get(query);
        },
    });
    vi.stubGlobal('document', {
        get hidden() { return hidden; },
        addEventListener: vi.fn((name, callback) => listeners.set(name, callback)),
        removeEventListener: vi.fn((name) => listeners.delete(name)),
    });
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) {
            this.callback = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
            observer = this;
        }
    });
    container = { clientWidth: 720, clientHeight: 720, appendChild: vi.fn() };
    renderer = new ThreeJSBreathingRenderer(container);
});

afterEach(() => {
    renderer?.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('retained breathing renderer', () => {
    it('switches every visual without replacing geometry or materials', () => {
        renderer.init();
        const initialObjects = [];
        renderer.scene.traverse((object) => {
            if (object.geometry) initialObjects.push([object, object.geometry, object.material]);
        });
        expect(Object.keys(BREATHING_VISUAL_PROFILES)).toHaveLength(12);
        for (let repeat = 0; repeat < 3; repeat += 1) {
            Object.keys(BREATHING_VISUAL_PROFILES).forEach((technique) => {
                renderer.setTechnique(technique);
                renderer.updateIntensity(0.8, 'inhale', 0.75);
                renderer.updateScene(12, 1 / 60);
                expect(renderer.currentTechnique).toBe(technique);
                expect(renderer.uniforms.uMode.value).toBe(BREATHING_VISUAL_PROFILES[technique].mode);
                initialObjects.forEach(([object, geometry, material]) => {
                    expect(object.geometry).toBe(geometry);
                    expect(object.material).toBe(material);
                });
            });
        }
        expect(container.appendChild).toHaveBeenCalledOnce();
        renderer.setTechnique('unknown-technique');
        expect(renderer.currentTechnique).toBe('deep-relaxation');
    });

    it('changes particle draw range and pixel ratio while preserving the artwork', () => {
        renderer.init();
        const particles = renderer.sceneObjects.particles.geometry;
        const mode = renderer.uniforms.uMode.value;
        renderer.setQuality('Low');
        expect(renderer.qualityName).toBe('Low');
        expect(particles.drawRange.count).toBe(220);
        expect(renderer.renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
        renderer.setQuality('High');
        expect(particles.drawRange.count).toBe(650);
        expect(renderer.renderer.setPixelRatio).toHaveBeenLastCalledWith(1.5);
        renderer.setQuality('bogus');
        expect(renderer.qualityName).toBe('High');
        expect(renderer.sceneObjects.particles.geometry).toBe(particles);
        expect(renderer.uniforms.uMode.value).toBe(mode);
    });

    it('resizes its camera and shader resolution through the observed host', () => {
        renderer.init();
        expect(observer.observe).toHaveBeenCalledWith(container);
        container.clientWidth = 844;
        container.clientHeight = 390;
        observer.callback();
        expect(renderer.camera.aspect).toBe(844 / 390);
        expect(renderer.uniforms.uResolution.value.toArray()).toEqual([844, 390]);
        expect(renderer.renderer.setSize).toHaveBeenLastCalledWith(844, 390, false);
        container.clientWidth = 0;
        container.clientHeight = 0;
        renderer.renderer.setSize.mockClear();
        observer.callback();
        expect(renderer.renderer.setSize).not.toHaveBeenCalled();
    });

    it('runs one frame owner, throttles Low quality, and sleeps while hidden', () => {
        renderer.setQuality('Low');
        renderer.start();
        renderer.start();
        expect(frames.size).toBe(1);
        advanceFrame(0);
        advanceFrame(16.7);
        advanceFrame(33.4);
        expect(renderer.renderer.render).toHaveBeenCalledTimes(2);
        expect(frames.size).toBe(1);
        hidden = true;
        listeners.get('visibilitychange')();
        expect(frames.size).toBe(0);
        expect(renderer.isRunning).toBe(true);
        hidden = false;
        listeners.get('visibilitychange')();
        listeners.get('visibilitychange')();
        expect(frames.size).toBe(1);
        advanceFrame(10000);
        expect(renderer.time).toBeLessThan(0.1);
        renderer.stop();
        expect(frames.size).toBe(0);
        expect(renderer.animationId).toBeNull();
    });

    it('keeps phase/expansion guidance with reduced motion and removes ambient drift', () => {
        renderer.init();
        const motionQuery = mediaQueries.get('(prefers-reduced-motion: reduce)');
        const change = motionQuery.addEventListener.mock.calls[0][1];
        change({ matches: true });
        renderer.setTechnique('box-breathing');
        renderer.setSessionPhase('retention');
        renderer.updateIntensity(0.6, 'hold2', 0.4);
        renderer.updateScene(10);
        expect(renderer.uniforms.uMotion.value).toBe(0);
        expect(renderer.uniforms.uBreath.value).toBe(0.6);
        expect(renderer.uniforms.uPhaseProgress.value).toBe(0.4);
        expect(renderer.uniforms.uSession.value).toBe(3);
        expect(renderer.motifs.geometry.rotation.y).toBe(0);
        expect(renderer.motifs.geometry.scale.x).toBe(1);
        expect(renderer.sceneObjects.motifs.scale.x).toBeCloseTo(0.944);
        renderer.setSessionPhase(null);
        expect(renderer.uniforms.uSession.value).toBe(0);
    });

    it('disposes nested resources once and removes all frame, resize and media owners', () => {
        renderer.start();
        const adapter = renderer.renderer;
        const geometries = new Set();
        const materials = new Set();
        renderer.scene.traverse((object) => {
            if (object.geometry) geometries.add(object.geometry);
            if (object.material) materials.add(object.material);
        });
        const resourceSpies = [...geometries, ...materials].map((resource) => vi.spyOn(resource, 'dispose'));
        renderer.dispose();
        renderer.dispose();
        resourceSpies.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
        expect(adapter.dispose).toHaveBeenCalledOnce();
        expect(adapter.forceContextLoss).toHaveBeenCalledOnce();
        expect(adapter.domElement.remove).toHaveBeenCalledOnce();
        expect(observer.disconnect).toHaveBeenCalled();
        expect(listeners.size).toBe(0);
        expect(frames.size).toBe(0);
        expect(renderer.renderer).toBeNull();
        expect(renderer.scene).toBeNull();
        expect(mediaQueries.get('(prefers-reduced-motion: reduce)').removeEventListener)
            .toHaveBeenCalledWith('change', renderer._motionHandler);
    });
});
