import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

import { IntroAnimation } from '../../src/ui/intro-animation.js';
import ThreeJSIntroRendererWebGPU from '../../src/ui/threejs-intro-renderer-webgpu.js';
import ThreeJSIntroRenderer from '../../src/ui/threejs-intro-renderer.js';

/**
 * Entering a mode dismissed the menu intro by destroying its renderer and removing its container,
 * so every return to the menu built a new GPU device, scene and pipelines (theme and rendering
 * audit 2026-10: REND-02). The dismissal now parks the renderer, hidden and stopped, and the
 * return revives it, as it already did for the container Odyssey hides on entry.
 */

function classList(initial = []) {
    const set = new Set(initial);
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), contains: (c) => set.has(c) };
}

function element(tag = 'div') {
    const children = [];
    const el = {
        tagName: tag.toUpperCase(),
        style: { removeProperty(key) { delete this[key]; } },
        classList: classList(),
        parentNode: null,
        appendChild(child) { children.push(child); child.parentNode = el; return child; },
        removeChild(child) { children.splice(children.indexOf(child), 1); child.parentNode = null; return child; },
        querySelector: () => null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    };
    return el;
}

function installDocument() {
    const body = element('body');
    body.classList = classList(['startup-intro-skipped']);
    body.contains = (node) => {
        for (let n = node; n; n = n.parentNode) if (n === body) return true;
        return false;
    };
    vi.stubGlobal('document', {
        body,
        createElement: element,
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
    });
    return body;
}

function renderer() {
    return {
        destroy: vi.fn(),
        setBackgroundMode: vi.fn(),
        update: vi.fn(),
        setAudioPulse: vi.fn(),
        setParked: vi.fn(),
        isLost: () => false,
    };
}

/** An intro on the menu: its background-only container in the page, a live renderer. */
function menuIntro(body) {
    const intro = new IntroAnimation();
    intro.container = element();
    intro.container.classList.add('background-only');
    intro.container.classList.add('active');
    body.appendChild(intro.container);
    intro.threeRenderer = renderer();
    intro.isAnimating = true;
    intro.hasCompleted = true;
    intro.menuBgReady = true;
    for (const name of ['ensureIntroMusic', 'setRendererPhase', 'setLoadingState', 'scheduleMenuLogoLayoutUpdate',
        'syncTitleBounds', 'installTetrominoPointerListener', '_claimMenuLogoIdentity', 'createStarfield']) {
        vi.spyOn(intro, name).mockImplementation(() => {});
    }
    vi.spyOn(intro, '_prefersReducedMotion').mockReturnValue(false);
    vi.spyOn(intro, 'createAnimatedTitle').mockImplementation(() => element());
    vi.spyOn(intro, 'initRenderer').mockImplementation(async () => { intro.threeRenderer = renderer(); });
    return intro;
}

describe('the menu renderer is parked on mode entry, not rebuilt on every return', () => {
    let body;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.stubGlobal('window', {
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
            matchMedia: () => ({ matches: false }),
            settings: {},
            location: { search: '' },
        });
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 7));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        body = installDocument();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('a dismissal keeps the renderer and its container, hidden and stopped', async () => {
        const intro = menuIntro(body);
        const kept = intro.threeRenderer;
        const { container } = intro;
        const dismissed = intro.dismiss();
        await vi.advanceTimersByTimeAsync(1000);
        await dismissed;
        expect(kept.destroy).not.toHaveBeenCalled();
        expect(intro.threeRenderer).toBe(kept);
        expect(intro.container).toBe(container);
        expect(body.contains(container)).toBe(true);
        expect(container.style.display).toBe('none');
        expect(intro.parked).toBe(true);
        expect(intro.animationFrameId).toBeNull();
        expect(intro.isAnimating).toBe(false);
        expect(kept.setParked).toHaveBeenCalledWith(true); // its screen-sized buffers shrink
        // A second dismissal while parked has nothing to fade.
        await expect(intro.dismiss()).resolves.toBeUndefined();
        expect(intro.parked).toBe(true);
    });

    it('the return to the menu revives the parked renderer: no new renderer, device or scene', async () => {
        const intro = menuIntro(body);
        const kept = intro.threeRenderer;
        const dismissed = intro.dismiss();
        await vi.advanceTimersByTimeAsync(1000);
        await dismissed;

        await intro.showBackgroundOnly();
        expect(intro.initRenderer).not.toHaveBeenCalled();
        expect(intro.threeRenderer).toBe(kept);
        expect(intro.container.style.display).toBe('');
        expect(intro.container.classList.contains('fade-out')).toBe(false);
        expect(intro.parked).toBe(false);
        expect(intro.isAnimating).toBe(true);
        expect(intro.animationFrameId).not.toBeNull(); // drawing again
        expect(kept.setBackgroundMode).toHaveBeenCalledWith(true);
        expect(kept.setParked).toHaveBeenLastCalledWith(false); // sized to the window again
        expect(intro.menuLayoutTrackingInstalled).toBe(true); // the dismissal tore it down
    });

    it('a parked renderer whose device was lost during play is rebuilt on the return', async () => {
        const intro = menuIntro(body);
        const lost = intro.threeRenderer;
        const dismissed = intro.dismiss();
        await vi.advanceTimersByTimeAsync(1000);
        await dismissed;
        lost.isLost = () => true; // a driver reset during play

        const showing = intro.showBackgroundOnly();
        await vi.advanceTimersByTimeAsync(0);
        await showing;
        expect(lost.destroy).toHaveBeenCalledOnce();
        expect(intro.initRenderer).toHaveBeenCalledOnce();
        expect(intro.threeRenderer).not.toBe(lost);
        expect(intro.parked).toBe(false);
        expect(body.contains(intro.container)).toBe(true);
    });

    it('a return during the dismissal fade waits for it, then revives instead of being hidden by it', async () => {
        const intro = menuIntro(body);
        const kept = intro.threeRenderer;
        intro.dismiss();
        const showing = intro.showBackgroundOnly(); // back to the menu before the fade ended
        await vi.advanceTimersByTimeAsync(1000);
        await showing;
        expect(intro.threeRenderer).toBe(kept);
        expect(intro.container.style.display).toBe('');
        expect(intro.parked).toBe(false);
        expect(intro.initRenderer).not.toHaveBeenCalled();
    });

    it('a parked WebGPU renderer draws one frame at a token size, ignores resizes, and comes back at full size', () => {
        window.innerWidth = 1600;
        window.innerHeight = 900;
        const r = Object.create(ThreeJSIntroRendererWebGPU.prototype);
        Object.assign(r, {
            renderer: { setSize: vi.fn(), setPixelRatio: vi.fn(), render: vi.fn() },
            camera: { aspect: 1, updateProjectionMatrix: vi.fn() },
            scene: {},
            postProcessing: { render: vi.fn() },
            _scenePass: { setSize: vi.fn() },
            _deviceLost: false,
            _renderPixelRatio: () => 1,
        });
        r.setParked(true);
        expect(r.renderer.setSize).toHaveBeenLastCalledWith(64, 36, false);
        expect(r._scenePass.setSize).toHaveBeenLastCalledWith(64, 36);
        expect(r.postProcessing.render).toHaveBeenCalledOnce(); // three resizes its targets as it renders
        r.onResize(); // the window resized during play
        expect(r.renderer.setSize).toHaveBeenCalledTimes(1);
        r.setParked(false);
        expect(r.renderer.setSize).toHaveBeenLastCalledWith(1600, 900);
        expect(r._scenePass.setSize).toHaveBeenLastCalledWith(1600, 900);
    });

    it('a parked WebGL renderer shrinks its drawing buffer and composer, and comes back at full size', () => {
        window.innerWidth = 1600;
        window.innerHeight = 900;
        const r = Object.create(ThreeJSIntroRenderer.prototype);
        Object.assign(r, {
            renderer: { setSize: vi.fn() },
            camera: { aspect: 1, updateProjectionMatrix: vi.fn() },
            composer: { setSize: vi.fn() },
        });
        r.setParked(true);
        expect(r.renderer.setSize).toHaveBeenLastCalledWith(64, 36, false);
        expect(r.composer.setSize).toHaveBeenLastCalledWith(64, 36);
        r.onResize();
        expect(r.renderer.setSize).toHaveBeenCalledTimes(1);
        r.setParked(false);
        expect(r.renderer.setSize).toHaveBeenLastCalledWith(1600, 900);
        expect(r.composer.setSize).toHaveBeenLastCalledWith(1600, 900);
    });
});
