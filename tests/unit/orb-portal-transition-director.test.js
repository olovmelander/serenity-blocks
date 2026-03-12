import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import * as THREE from 'three';
import {
    OrbPortalTransitionDirector,
    ORB_PORTAL_STATES,
    projectWorldToNormalizedScreen,
} from '../../src/core/odyssey/OrbPortalTransitionDirector.js';

function createMockCanvas() {
    return {
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,AAA'),
    };
}

function createStubCompositor() {
    return {
        show: vi.fn(),
        showWithSnapshot: vi.fn().mockReturnValue(true),
        showLiveOrbLock: vi.fn(),
        hideLiveOrbLock: vi.fn(),
        setCoverageMode: vi.fn(),
        setPortalAnchor: vi.fn(),
        setArrivalPalette: vi.fn(),
        setArrivalFlash: vi.fn(),
        setArrivalSilhouette: vi.fn(),
        setRevealMask: vi.fn(),
        setBoardSnapshot: vi.fn(),
        attachWarpContainer: vi.fn(),
        startArrivalHoldAnimation: vi.fn(),
        playReveal: vi.fn().mockResolvedValue(undefined),
        hide: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn(),
        dispose: vi.fn(),
    };
}

describe('projectWorldToNormalizedScreen', () => {
    it('projects the camera center to normalized center', () => {
        const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
        camera.position.set(0, 0, 5);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        const result = projectWorldToNormalizedScreen(new THREE.Vector3(0, 0, 0), camera);

        expect(result.onScreen).toBe(true);
        expect(result.x).toBeCloseTo(0.5, 2);
        expect(result.y).toBeCloseTo(0.5, 2);
    });
});

describe('OrbPortalTransitionDirector', () => {
    it('runs the expected state sequence and resolves successfully', async () => {
        const stateOrder = [];
        const compositor = createStubCompositor();

        const director = new OrbPortalTransitionDirector({
            transitionManager: {
                playOrbPortal: vi.fn().mockResolvedValue(undefined),
                warpRenderer: { hideContainer: vi.fn() },
            },
            compositor,
        });

        const result = await director.startLevelEntry({
            levelId: 1,
            levelConfig: { chapter: 1 },
            boardController: {
                captureFrame: vi.fn().mockReturnValue(createMockCanvas()),
                renderOnce: vi.fn(),
                pauseRendering: vi.fn(),
                nodeManager: {
                    getNodeCinematicMetrics: vi.fn().mockReturnValue({
                        center: { x: 0.48, y: 0.51 },
                        radius: 0.12,
                        onScreen: true,
                    }),
                    getNodePosition: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
                    getChapterColor: vi.fn().mockReturnValue(new THREE.Color(0xff4400)),
                },
                camera: (() => {
                    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
                    cam.position.set(0, 0, 5);
                    cam.lookAt(0, 0, 0);
                    cam.updateProjectionMatrix();
                    cam.updateMatrixWorld(true);
                    return cam;
                })(),
            },
            qualityPreset: 'High',
            deps: {
                themeManager: {
                    waitForThemeReady: vi.fn().mockResolvedValue(true),
                },
                timings: {
                    ORB_LOCK: 1,
                    PORTAL_BREACH: 1,
                    TUNNEL: 1,
                    ARRIVAL_HOLD_BASE: 1,
                    ARRIVAL_HOLD_MAX_EXTRA: 20,
                    REVEAL: 1,
                },
                modeHooks: {
                    onStateChange: (state) => stateOrder.push(state),
                    prepareGameplayContainers: vi.fn().mockResolvedValue(true),
                    prefetchLevelAssets: vi.fn().mockResolvedValue(true),
                    pulseOrbNode: vi.fn(),
                    startCameraZoom: vi.fn(),
                    hideGameUIForTransition: vi.fn(),
                    activateThemeVisuals: vi.fn().mockResolvedValue(true),
                    prepareGameplayReveal: vi.fn().mockResolvedValue(true),
                    loadLevelInBackground: vi.fn().mockResolvedValue(true),
                    setBoardViewMode: vi.fn(),
                    showGameplayView: vi.fn().mockResolvedValue(undefined),
                    showLevelIntro: vi.fn().mockResolvedValue(undefined),
                    startLevel: vi.fn().mockResolvedValue(undefined),
                    waitForFirstGameplayFrame: vi.fn().mockResolvedValue(true),
                    confirmFirstGameplayComposite: vi.fn().mockResolvedValue(true),
                    scheduleBoardDispose: vi.fn(),
                    restoreUIAfterAbort: vi.fn(),
                    playTransitionCue: vi.fn(),
                },
            },
        });

        expect(result.success).toBe(true);
        expect(result.degraded).toBe(false);
        expect(stateOrder).toEqual([
            ORB_PORTAL_STATES.PREPARE,
            ORB_PORTAL_STATES.ORB_LOCK,
            ORB_PORTAL_STATES.PORTAL_BREACH,
            ORB_PORTAL_STATES.TUNNEL,
            ORB_PORTAL_STATES.ARRIVAL_HOLD,
            ORB_PORTAL_STATES.REVEAL,
            ORB_PORTAL_STATES.CLEANUP,
        ]);
    });

    it('marks degraded when readiness gates timeout', async () => {
        const compositor = createStubCompositor();

        const director = new OrbPortalTransitionDirector({
            transitionManager: {
                playOrbPortal: vi.fn().mockResolvedValue(undefined),
                warpRenderer: { hideContainer: vi.fn() },
            },
            compositor,
        });

        const never = new Promise(() => {});

        const result = await director.startLevelEntry({
            levelId: 2,
            levelConfig: { chapter: 2 },
            boardController: {
                captureFrame: vi.fn().mockReturnValue(createMockCanvas()),
                renderOnce: vi.fn(),
                pauseRendering: vi.fn(),
                nodeManager: {
                    getNodeCinematicMetrics: vi.fn().mockReturnValue({
                        center: { x: 0.5, y: 0.5 },
                        radius: 0.12,
                        onScreen: true,
                    }),
                    getNodePosition: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
                    getChapterColor: vi.fn().mockReturnValue(new THREE.Color(0x0088ff)),
                },
                camera: (() => {
                    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
                    cam.position.set(0, 0, 5);
                    cam.lookAt(0, 0, 0);
                    cam.updateProjectionMatrix();
                    cam.updateMatrixWorld(true);
                    return cam;
                })(),
            },
            qualityPreset: 'Medium',
            deps: {
                themeManager: {
                    waitForThemeReady: vi.fn().mockImplementation(() => never),
                },
                timings: {
                    ORB_LOCK: 1,
                    PORTAL_BREACH: 1,
                    TUNNEL: 1,
                    ARRIVAL_HOLD_BASE: 1,
                    ARRIVAL_HOLD_MAX_EXTRA: 20,
                    REVEAL: 1,
                },
                modeHooks: {
                    prepareGameplayContainers: vi.fn().mockResolvedValue(true),
                    prefetchLevelAssets: vi.fn().mockImplementation(() => never),
                    pulseOrbNode: vi.fn(),
                    startCameraZoom: vi.fn(),
                    hideGameUIForTransition: vi.fn(),
                    activateThemeVisuals: vi.fn().mockImplementation(() => never),
                    prepareGameplayReveal: vi.fn().mockResolvedValue(true),
                    loadLevelInBackground: vi.fn().mockImplementation(() => never),
                    setBoardViewMode: vi.fn(),
                    showGameplayView: vi.fn().mockResolvedValue(undefined),
                    showLevelIntro: vi.fn().mockResolvedValue(undefined),
                    startLevel: vi.fn().mockResolvedValue(undefined),
                    waitForFirstGameplayFrame: vi.fn().mockImplementation(() => never),
                    confirmFirstGameplayComposite: vi.fn().mockImplementation(() => never),
                    scheduleBoardDispose: vi.fn(),
                    restoreUIAfterAbort: vi.fn(),
                },
            },
        });

        expect(result.success).toBe(true);
        expect(result.degraded).toBe(true);
    });

    it('shows compositor only through atomic showWithSnapshot at breach', async () => {
        const compositor = createStubCompositor();
        const director = new OrbPortalTransitionDirector({
            transitionManager: {
                playOrbPortal: vi.fn().mockResolvedValue(undefined),
                warpRenderer: { hideContainer: vi.fn() },
            },
            compositor,
        });

        await director.startLevelEntry({
            levelId: 3,
            levelConfig: { chapter: 3 },
            boardController: {
                captureFrame: vi.fn().mockReturnValue(createMockCanvas()),
                renderOnce: vi.fn(),
                pauseRendering: vi.fn(),
                nodeManager: {
                    getNodeCinematicMetrics: vi.fn().mockReturnValue({
                        center: { x: 0.42, y: 0.46 },
                        radius: 0.14,
                        onScreen: true,
                    }),
                    getNodePosition: vi.fn().mockReturnValue(new THREE.Vector3(0, 0, 0)),
                    getChapterColor: vi.fn().mockReturnValue(new THREE.Color(0x55aaee)),
                },
                camera: (() => {
                    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
                    cam.position.set(0, 0, 5);
                    cam.lookAt(0, 0, 0);
                    cam.updateProjectionMatrix();
                    cam.updateMatrixWorld(true);
                    return cam;
                })(),
            },
            deps: {
                themeManager: {
                    waitForThemeReady: vi.fn().mockResolvedValue(true),
                },
                timings: {
                    ORB_LOCK: 1,
                    PORTAL_BREACH: 1,
                    TUNNEL: 1,
                    ARRIVAL_HOLD_BASE: 1,
                    ARRIVAL_HOLD_MAX_EXTRA: 20,
                    REVEAL: 1,
                },
                modeHooks: {
                    prepareGameplayContainers: vi.fn().mockResolvedValue(true),
                    prefetchLevelAssets: vi.fn().mockResolvedValue(true),
                    pulseOrbNode: vi.fn(),
                    startCameraZoom: vi.fn(),
                    hideGameUIForTransition: vi.fn(),
                    activateThemeVisuals: vi.fn().mockResolvedValue(true),
                    prepareGameplayReveal: vi.fn().mockResolvedValue(true),
                    loadLevelInBackground: vi.fn().mockResolvedValue(true),
                    setBoardViewMode: vi.fn(),
                    showGameplayView: vi.fn().mockResolvedValue(undefined),
                    showLevelIntro: vi.fn().mockResolvedValue(undefined),
                    startLevel: vi.fn().mockResolvedValue(undefined),
                    waitForFirstGameplayFrame: vi.fn().mockResolvedValue(true),
                    confirmFirstGameplayComposite: vi.fn().mockResolvedValue(true),
                    scheduleBoardDispose: vi.fn(),
                    restoreUIAfterAbort: vi.fn(),
                },
            },
        });

        expect(compositor.showWithSnapshot).toHaveBeenCalledTimes(1);
        expect(compositor.show).not.toHaveBeenCalled();
    });

    it('defers theme activation until after breach snapshot is shown', async () => {
        const order = [];
        const compositor = createStubCompositor();
        compositor.showWithSnapshot.mockImplementation(() => {
            order.push('snapshot');
            return true;
        });

        const director = new OrbPortalTransitionDirector({
            transitionManager: {
                playOrbPortal: vi.fn().mockResolvedValue(undefined),
                warpRenderer: { hideContainer: vi.fn(), container: {} },
            },
            compositor,
        });

        await director.startLevelEntry({
            levelId: 4,
            levelConfig: { chapter: 4 },
            boardController: {
                captureFrame: vi.fn().mockReturnValue(createMockCanvas()),
                renderOnce: vi.fn(),
                pauseRendering: vi.fn(),
                nodeManager: {
                    getNodeCinematicMetrics: vi.fn().mockReturnValue({
                        center: { x: 0.4, y: 0.45 },
                        radius: 0.11,
                        onScreen: true,
                    }),
                    getChapterColor: vi.fn().mockReturnValue(new THREE.Color(0xffaa44)),
                },
                camera: (() => {
                    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 100);
                    cam.position.set(0, 0, 5);
                    cam.lookAt(0, 0, 0);
                    cam.updateProjectionMatrix();
                    cam.updateMatrixWorld(true);
                    return cam;
                })(),
            },
            deps: {
                timings: {
                    ORB_LOCK: 1,
                    PORTAL_BREACH: 1,
                    TUNNEL: 1,
                    ARRIVAL_HOLD_BASE: 1,
                    ARRIVAL_HOLD_MAX_EXTRA: 20,
                    REVEAL: 1,
                },
                modeHooks: {
                    prepareGameplayContainers: vi.fn().mockImplementation(async () => {
                        order.push('prepareContainers');
                        return true;
                    }),
                    prefetchLevelAssets: vi.fn().mockImplementation(async () => {
                        order.push('prefetch');
                        return true;
                    }),
                    pulseOrbNode: vi.fn(),
                    startCameraZoom: vi.fn(),
                    hideGameUIForTransition: vi.fn(),
                    activateThemeVisuals: vi.fn().mockImplementation(async () => {
                        order.push('activateTheme');
                        return true;
                    }),
                    prepareGameplayReveal: vi.fn().mockResolvedValue(true),
                    setBoardViewMode: vi.fn(),
                    showLevelIntro: vi.fn().mockResolvedValue(undefined),
                    startLevel: vi.fn().mockResolvedValue(undefined),
                    confirmFirstGameplayComposite: vi.fn().mockResolvedValue(true),
                    scheduleBoardDispose: vi.fn(),
                    restoreUIAfterAbort: vi.fn(),
                },
            },
        });

        expect(order.indexOf('prefetch')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('snapshot')).toBeGreaterThan(order.indexOf('prefetch'));
        expect(order.indexOf('activateTheme')).toBeGreaterThan(order.indexOf('snapshot'));
    });

    it('uses cinematic node metrics to compute portal radius', () => {
        const director = new OrbPortalTransitionDirector();
        const anchor = director.computePortalAnchor({
            nodeManager: {
                getNodeCinematicMetrics: vi.fn().mockReturnValue({
                    center: { x: 0.33, y: 0.61 },
                    radius: 0.18,
                    onScreen: true,
                }),
            },
            camera: {},
        }, 9);

        expect(anchor.x).toBeCloseTo(0.33, 4);
        expect(anchor.y).toBeCloseTo(0.61, 4);
        expect(anchor.radius).toBeCloseTo(0.1944, 4);
    });
});
