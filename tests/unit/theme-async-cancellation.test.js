import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { BaseTheme } from '../../src/themes/base-theme.js';
import TornadoTheme from '../../src/themes/tornado/tornado-theme.js';
import SkyChildrenV2Theme from '../../src/themes/sky-children-v2/sky-children-v2-theme.js';

const loaderMocks = vi.hoisted(() => ({
    loadAsync: vi.fn(),
}));

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
    GLTFLoader: class MockGLTFLoader {
        loadAsync(...args) {
            return loaderMocks.loadAsync(...args);
        }
    },
}));

vi.mock('@utils/helpers.js', () => ({
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)),
}));

// Tornado's lifecycle is what is under test here, not its picture: the world and the post stay out.
vi.mock('../../src/themes/tornado/tornado-world.js', () => ({
    TornadoWorld: vi.fn(),
    REST_RIG: { near: 1, far: 1000 },
    fovForAspect: () => 40,
}));
vi.mock('../../src/themes/tornado/tornado-post.js', () => ({
    TornadoPost: vi.fn(),
    POST_LOOK: {},
    createPassThroughPipeline: () => null,
}));

function installLifecycleGlobals() {
    vi.stubGlobal('window', {
        innerWidth: 1280,
        innerHeight: 720,
        location: { search: '' },
        settings: null,
        setTimeout,
        clearTimeout,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', {
        getElementById: vi.fn(() => null),
        querySelectorAll: vi.fn(() => []),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
}

beforeEach(() => {
    installLifecycleGlobals();
});

afterEach(() => {
    loaderMocks.loadAsync.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('theme async lifecycle cancellation', () => {
    it('does not let Tornado resume when BaseTheme rejects the resume', () => {
        vi.spyOn(BaseTheme.prototype, 'resume').mockReturnValue(false);
        const theme = new TornadoTheme();

        // Everything a resume needs is there, and a quality rebuild is waiting for it.
        theme.world = {};
        theme.renderer = {};
        theme.scene = {};
        theme.camera = {};
        theme.rebuildPending = true;
        theme.lastFrameMs = 1234;
        const resize = vi.spyOn(theme, 'resize').mockImplementation(() => {});
        const scheduleLayoutReads = vi.spyOn(theme, 'scheduleLayoutReads');
        const ensureModeManagerListeners = vi.spyOn(theme, 'ensureModeManagerListeners');
        const queueRebuild = vi.spyOn(theme, 'queueRebuild');
        const animate = vi.spyOn(theme, 'animate');

        expect(theme.resume()).toBe(false);
        // Nothing is re-armed: no resize catch-up, no layout read, no listener, no rebuild, no loop.
        expect(resize).not.toHaveBeenCalled();
        expect(scheduleLayoutReads).not.toHaveBeenCalled();
        expect(ensureModeManagerListeners).not.toHaveBeenCalled();
        expect(queueRebuild).not.toHaveBeenCalled();
        expect(animate).not.toHaveBeenCalled();
        expect(requestAnimationFrame).not.toHaveBeenCalled();
        expect(theme.rebuildPending).toBe(true);
        expect(theme.lastFrameMs).toBe(1234);
    });

    it('resolves canceled async turns for sky-children', async () => {
        const theme = new SkyChildrenV2Theme();
        theme.isActive = true;
        theme.lifecycleState = 'running';
        const generation = theme.lifecycleGeneration;
        const pendingTurn = theme.waitForAsyncTurn(60_000, generation);

        theme.stop();

        await expect(pendingTurn).resolves.toBe(false);
        expect(theme._asyncTimeouts.size).toBe(0);
        expect(theme._asyncWaitResolvers.size).toBe(0);
    });
});
