import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupApplication } from '../../src/utils/application-cleanup.js';

// main.js bootstraps on import. Execute its complete initializer against inert services,
// replacing only the dynamic module loader so its completion can be controlled.
const main = readFileSync('src/main.js', 'utf8');
const start = main.indexOf('    async initializeManagers() {');
const end = main.indexOf('\n    /**\n     * Initialize global Serenity Hub', start);
const source = main.slice(start, end);
const body = source.slice(source.indexOf('{') + 1, source.lastIndexOf('}'))
    .replace("import('./core/steam/steam-cloud-sync.js')", 'loadCloudManager()');

function fixture() {
    const settings = { gameMode: 'single' };
    const sound = {
        songsData: [{}],
        setMusicVolume: vi.fn(),
        setSFXVolume: vi.fn(),
        setSoundSet: vi.fn(),
        populateMusicDropdown: vi.fn(),
        isMusicPlaying: () => true,
        resumeAudioContext: vi.fn(),
        ensureTrackPlaybackSynced: vi.fn(async () => {}),
        cleanup: vi.fn(),
    };
    const cloudInitialize = vi.fn();
    const cloudConstructor = vi.fn();
    class CloudManager {
        constructor(options) { cloudConstructor(options); }
        initialize() { cloudInitialize(); }
    }
    let releaseImport;
    const loadCloudManager = vi.fn(() => new Promise((resolve) => {
        releaseImport = () => resolve({ default: CloudManager });
    }));
    const deps = {
        HighScoreManager: class {},
        DemoManager: class {},
        SettingsManager: class { load() {} get() { return settings; } },
        DisplayManager: class {},
        ModalManager: class { setGamepadController() {} },
        ThemeManager: class { suspendThemes() {} },
        InputController: class {},
        GamepadController: class {
            initialize() {} setPauseCallbacks() {} updateBindings() {}
        },
        GameModeUI: class { setModeFromSettings() {} },
        setPieceLockRippleCss: vi.fn(),
        applyReduceFlashingClass: vi.fn(),
        shouldUseDesktopPerformancePolicy: () => false,
        setActiveDesktopPerformancePolicy: vi.fn(),
        shouldDeferStartupAudio: () => false,
        getThemeCollection: () => ({}),
        sanitizeCollectionThemeSetting: vi.fn(),
        desktopRuntimeConfig: { isElectron: false },
        isPackagedWindowsBaselineProfile: () => false,
        isPackagedWindowsSafeMode: () => false,
        loadCloudManager,
    };
    // eslint-disable-next-line no-new-func -- executes the production method, with controlled imports
    const initialize = new Function(...Object.keys(deps), `return async function () {
        let introMusicInitialized = false;
        ${body}
    };`)(...Object.values(deps));
    const scheduled = new Map();
    const app = {
        soundManager: sound,
        cleanupHandlers: [],
        fpsCounter: {},
        applyPackagedWindowsFirstRunDisplayPolicy: vi.fn(),
        getResolvedDesktopSettings: (value) => value,
        applyDisplaySettings: vi.fn(),
        applyFrameRateSettings: vi.fn(),
        applyEffectQuality: vi.fn(),
        scheduleDeferredStartupTask: (name, task) => scheduled.set(name, task),
    };
    return {
        app, sound, scheduled, cloudInitialize, cloudConstructor, loadCloudManager,
        initialize: () => initialize.call(app),
        releaseImport: () => releaseImport(),
    };
}

beforeEach(() => {
    const document = new EventTarget();
    document.getElementById = vi.fn();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('deferred manager lifecycle', () => {
    it('does not construct or publish cloud synchronization when its import finishes after cleanup', async () => {
        const test = fixture();
        await test.initialize();
        const task = test.scheduled.get('steam-cloud-sync')();
        expect(test.loadCloudManager).toHaveBeenCalledTimes(1);
        await cleanupApplication(test.app);
        test.releaseImport();
        await task;
        expect(test.cloudConstructor).not.toHaveBeenCalled();
        expect(test.cloudInitialize).not.toHaveBeenCalled();
        expect(test.app.cloudSyncManager).toBeUndefined();
        expect(window.cloudSyncManager).toBeUndefined();
    });

    it('constructs and initializes cloud synchronization for a live application', async () => {
        const test = fixture();
        await test.initialize();
        const task = test.scheduled.get('steam-cloud-sync')();
        test.releaseImport();
        await task;
        expect(test.cloudConstructor).toHaveBeenCalledTimes(1);
        expect(test.cloudInitialize).toHaveBeenCalledTimes(1);
        expect(window.cloudSyncManager).toBe(test.app.cloudSyncManager);
        await cleanupApplication(test.app);
    });

    it('retires both first-gesture listeners before asynchronous mode cleanup', async () => {
        const test = fixture();
        await test.initialize();
        let finishModeCleanup;
        test.app.gameModeManager = { cleanup: () => new Promise((resolve) => { finishModeCleanup = resolve; }) };
        const cleanup = cleanupApplication(test.app);
        document.dispatchEvent(new Event('click'));
        document.dispatchEvent(new Event('keydown'));
        expect(test.sound.resumeAudioContext).not.toHaveBeenCalled();
        expect(test.sound.ensureTrackPlaybackSynced).not.toHaveBeenCalled();
        await Promise.resolve();
        finishModeCleanup();
        await cleanup;
        document.dispatchEvent(new Event('click'));
        expect(test.sound.cleanup).toHaveBeenCalledTimes(1);
        expect(test.sound.resumeAudioContext).not.toHaveBeenCalled();
    });

    it('unlocks audio once across click and keyboard gestures while the app is live', async () => {
        const test = fixture();
        await test.initialize();
        document.dispatchEvent(new Event('keydown'));
        document.dispatchEvent(new Event('click'));
        expect(test.sound.resumeAudioContext).toHaveBeenCalledTimes(1);
        expect(test.sound.ensureTrackPlaybackSynced).toHaveBeenCalledWith({
            reason: 'user-gesture-audio-unlock', force: true,
        });
        await cleanupApplication(test.app);
    });
});
