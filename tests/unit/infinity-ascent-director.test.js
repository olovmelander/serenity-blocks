/**
 * Infinity's ascent director (src/ui/infinity/ascent/infinity-ascent.js) against a fake mode:
 * a wheel pull gives way and asks the mode for the pause, the view flies, the themes hear the
 * signal and the theme layer sinks, a game key sends it home at once, an idle wait lands it, a
 * menu ends it from outside, and stopping leaves everything as it was.
 */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { InfinityAscent } from '../../src/ui/infinity/ascent/infinity-ascent.js';
import { readExplorationSignal, setExplorationSignal } from '../../src/core/exploration-signal.js';
import { FLIGHT } from '../../src/ui/infinity/ascent/tower-flight.js';
import { looseNode, looseWindow } from './helpers/loose-dom.js';

function fakeMode() {
    let exploring = false;
    const settings = { visibleRows: 20, currentTopRow: 60, viewOffsetRows: 0 };
    const scene = {
        cameraSettings: settings,
        setViewOffsetRows: vi.fn((rows) => { settings.viewOffsetRows = rows; }),
        updateCameraPosition: vi.fn((row) => { settings.currentTopRow = row; }),
    };
    const juice = {
        dip: vi.fn(), bounce: vi.fn(), setFlight: vi.fn(),
    };
    const state = { board: Array.from({ length: 140 }, () => []), maxRows: 1000 };
    const host = {
        getBoardScene: () => scene,
        getGameState: () => state,
        getMinimap: () => null,
        getBoardJuice: () => juice,
        isRunning: () => true,
        isExternallyPaused: () => false,
        isExploring: () => exploring,
        beginExploration: vi.fn(async () => {
            exploring = true;
            return true;
        }),
        endExploration: vi.fn(() => {
            exploring = false;
            return true;
        }),
        homeTop: () => 60,
        summitRow: () => 70,
        updateMinimapView: vi.fn(),
        settings: () => ({}),
        soundManager: null,
        themeManager: null,
        gamepadController: null,
    };
    return {
        host, scene, juice, isExploring: () => exploring,
    };
}

const wheel = (deltaY) => ({
    deltaY, deltaX: 0, deltaMode: 0, preventDefault: vi.fn(),
});

/** Drive the director's frames by hand. */
function frames(ascent, seconds, start) {
    let now = start;
    for (let i = 0; i < Math.round(seconds * 60); i++) {
        now += 1000 / 60;
        ascent.step(1 / 60, now);
    }
    return now;
}

describe('the ascent director', () => {
    let documentNode;
    let themeLayer;
    let clock;

    beforeEach(() => {
        clock = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => clock);
        documentNode = looseNode('document');
        themeLayer = looseNode('div');
        documentNode.querySelector = (selector) => (selector === '.background-container' ? themeLayer : null);
        documentNode.createElement = (tag) => looseNode(tag);
        vi.stubGlobal('document', documentNode);
        vi.stubGlobal('window', looseWindow({ settings: { keyBindings: { moveLeft: 'ArrowLeft', hardDrop: 'Space' } } }));
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        setExplorationSignal(null);
    });

    it('turns a wheel pull into a look the mode pauses for, and the world follows the view', async () => {
        const { host, scene, isExploring } = fakeMode();
        const ascent = new InfinityAscent(host);
        ascent.start();
        expect(documentNode.listenerCount('wheel')).toBe(1);
        expect(readExplorationSignal()).toBeNull();

        // A pull up the tower: the first notch is a peek.
        const first = wheel(-100);
        ascent.handleWheel(first);
        expect(first.preventDefault).toHaveBeenCalled();
        clock = frames(ascent, 0.1, clock);
        expect(scene.setViewOffsetRows).toHaveBeenCalled();
        expect(host.beginExploration).not.toHaveBeenCalled();
        // The second gives way.
        ascent.handleWheel(wheel(-100));
        clock = frames(ascent, 0.05, clock);
        expect(host.beginExploration).toHaveBeenCalledOnce();
        await Promise.resolve();
        await Promise.resolve();
        expect(isExploring()).toBe(true);
        expect(ascent.flight.phase).toBe('free');

        // Rising into the sky: the themes hear it, the theme layer sinks, the board flies.
        ascent.handleWheel(wheel(-600));
        clock = frames(ascent, 1, clock);
        const signal = readExplorationSignal();
        expect(signal.weight).toBeGreaterThan(0.5);
        expect(signal.rise).toBeGreaterThan(0.3);
        expect(signal.timeScale).toBeLessThan(0.7);
        expect(scene.cameraSettings.currentTopRow).toBeLessThan(45);
        expect(themeLayer.style.transform).toMatch(/^translate3d\(0, \d+(\.\d)?px, 0\)$/);
        expect(ascent.getDiagnostics().themeShiftPx).toBeGreaterThan(0);

        ascent.stop();
        expect(documentNode.listenerCount('wheel')).toBe(0);
        expect(readExplorationSignal()).toBeNull();
        expect(themeLayer.style.transform).toBe('');
    });

    it('goes home at once on a game key, and lands by itself after a while without input', async () => {
        const { host, isExploring } = fakeMode();
        const ascent = new InfinityAscent(host);
        ascent.start();
        ascent.handleWheel(wheel(300));
        clock = frames(ascent, 0.05, clock);
        await Promise.resolve();
        await Promise.resolve();
        expect(isExploring()).toBe(true);
        documentNode.fire('keydown', { key: 'ArrowLeft' });
        expect(host.endExploration).toHaveBeenCalledOnce();
        expect(isExploring()).toBe(false);
        expect(ascent.flight.phase).toBe('idle');
        // A key that is no game action does nothing.
        documentNode.fire('keydown', { key: 'q' });
        expect(host.endExploration).toHaveBeenCalledOnce();

        // Again, and this time let it be.
        ascent.handleWheel(wheel(300));
        clock = frames(ascent, 0.05, clock);
        await Promise.resolve();
        await Promise.resolve();
        expect(isExploring()).toBe(true);
        clock = frames(ascent, FLIGHT.IDLE_RETURN_MS / 1000 + FLIGHT.LAND_MAX_S + 0.5, clock);
        expect(host.endExploration).toHaveBeenCalledTimes(2);
        expect(isExploring()).toBe(false);
        ascent.stop();
    });

    it('lets the mode end a look from outside (a menu), and fades out', async () => {
        const { host } = fakeMode();
        const ascent = new InfinityAscent(host);
        ascent.start();
        ascent.handleWheel(wheel(300));
        clock = frames(ascent, 0.05, clock);
        await Promise.resolve();
        await Promise.resolve();
        clock = frames(ascent, 0.5, clock);
        expect(ascent.presence).toBeGreaterThan(0.5);
        ascent.onExplorationEnded();
        expect(ascent.flight.phase).toBe('idle');
        // The world exhales over a few seconds (the slow clock eases back on real time).
        clock = frames(ascent, 4, clock);
        expect(ascent.presence).toBe(0);
        expect(ascent.weight).toBe(0);
        expect(readExplorationSignal()).toBeNull();
        ascent.stop();
    });

    it('keeps out of a menu\'s own scrolling and holds still under reduced motion', async () => {
        const { host, scene } = fakeMode();
        host.isExternallyPaused = () => true;
        const ascent = new InfinityAscent(host);
        ascent.start();
        const event = wheel(300);
        ascent.handleWheel(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
        ascent.stop();

        const calm = fakeMode();
        calm.host.settings = () => ({ reducedMotion: true });
        const still = new InfinityAscent(calm.host);
        still.start();
        still.handleWheel(wheel(-300));
        clock = frames(still, 0.05, clock);
        await Promise.resolve();
        await Promise.resolve();
        still.handleWheel(wheel(-600));
        clock = frames(still, 1, clock);
        const signal = readExplorationSignal();
        // The world still slows, but nothing moves for the eye.
        expect(signal.timeScale).toBeLessThan(0.8);
        expect(signal.rise).toBe(0);
        expect(signal.speed).toBe(0);
        expect(themeLayer.style.transform || '').toBe('');
        expect(calm.juice.setFlight.mock.calls.every(([lean, stretch]) => lean === 0 && stretch === 0)).toBe(true);
        expect(scene.updateCameraPosition).not.toHaveBeenCalled();
        still.stop();
    });
});
