import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import SunfallTheme from '../../src/themes/sunfall/sunfall-theme.js';
import { SunfallDirector } from '../../src/themes/sunfall/sunfall-director.js';
import { SUNFALL_QUALITY_PRESETS } from '../../src/themes/sunfall/sunfall-quality.js';

const flush = async () => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

function fakeModeManager() {
    const handlers = new Map();
    return {
        handlers,
        on(event, handler) {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(handler);
            return () => handlers.set(event, handlers.get(event).filter((h) => h !== handler));
        },
        emit(event) { (handlers.get(event) || []).forEach((h) => h({})); },
    };
}

function liveTheme(manager = fakeModeManager()) {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { serenityBlocks: { gameModeManager: manager } }));
    const theme = new SunfallTheme();
    Object.assign(theme, { isActive: true, isPaused: false, renderer: {}, quality: 'High' });
    theme.director = new SunfallDirector({ level: 1 });
    return theme;
}

describe('Sunfall: the New Growth cap follows the tier', () => {
    it('gives Minimal fewer shoots than Low (its 0 used to fall back to 36)', () => {
        const director = new SunfallDirector();
        director.setNewGrowthLimit(SUNFALL_QUALITY_PRESETS.Minimal.newGrowthSlots);
        const minimal = director.maxNewGrowth;
        director.setNewGrowthLimit(SUNFALL_QUALITY_PRESETS.Low.newGrowthSlots);
        expect(minimal).toBe(8);
        expect(director.maxNewGrowth).toBe(16);
        expect(minimal).toBeLessThan(director.maxNewGrowth);
    });

    it('drops the shoots a lower tier has no room for', () => {
        const director = new SunfallDirector({ maxNewGrowth: 36 });
        for (let i = 0; i < 30; i += 1) director._spawnShoot({});
        director.setNewGrowthLimit(SUNFALL_QUALITY_PRESETS.Low.newGrowthSlots);
        expect(director.newGrowthShoots).toHaveLength(16);
    });
});

describe('Sunfall: a run ends and the next one starts', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('closes the cloud deck on game over and opens a fresh session at level 1 on the next run', () => {
        const manager = fakeModeManager();
        const theme = liveTheme(manager);
        theme.setupEvents();
        theme.level = 7;
        theme.director.onLevelUp(7);
        theme.director.onCombo(4);

        window.dispatchEvent(new Event('gameOver'));
        expect(theme.director.gameOverActive).toBe(true);

        manager.emit('modeStarted');
        expect(theme.director.gameOverActive).toBe(false);
        expect(theme.director.level).toBe(1);
        expect(theme.director.comboCount).toBe(0);
        expect(theme.level).toBe(1);

        // Torn down with the runtime: no listener left on the window or the manager.
        theme.disposeRuntime();
        expect(manager.handlers.get('modeStarted')).toHaveLength(0);
        expect(() => window.dispatchEvent(new Event('gameOver'))).not.toThrow();
    });

    it('subscribes once to a mode manager that appears after the first build', () => {
        const theme = liveTheme();
        window.serenityBlocks = {};
        theme.setupEvents();
        const manager = fakeModeManager();
        window.serenityBlocks.gameModeManager = manager;
        theme.stepFrame(0); // no world yet: returns before the subscription
        theme.world = { setPointer() {}, applySnapshot() {} };
        theme.camera = {};
        theme.renderer = { render() {} };
        theme.stepFrame(16);
        theme.stepFrame(32);
        expect(manager.handlers.get('modeStarted')).toHaveLength(1);
    });
});

describe('Sunfall: settings that rebuild or resize', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('defers a new tier chosen behind the menu to the resume, instead of dropping it', async () => {
        const theme = liveTheme();
        theme.isPaused = true;
        const createScene = vi.spyOn(theme, 'createScene').mockResolvedValue(undefined);
        theme.handleSettingsChanged({ effectQuality: 'Low' });
        await flush();
        expect(createScene).not.toHaveBeenCalled();
        expect(theme.pendingQuality).toBe('Low');
        expect(theme.rebuildPending).toBe(true);
    });

    it('hands a failed rebuild to the manager instead of leaving an empty theme', async () => {
        const theme = liveTheme();
        const error = new Error('no device');
        vi.spyOn(theme, 'createScene').mockRejectedValue(error);
        vi.spyOn(console, 'error').mockImplementation(() => {});
        theme.onRuntimeFailure = vi.fn();
        theme.handleSettingsChanged({ effectQuality: 'Low' });
        await flush();
        expect(theme.onRuntimeFailure).toHaveBeenCalledWith(error);
    });

    it('applies a new render scale without waiting for a window resize', async () => {
        const theme = liveTheme();
        const resize = vi.spyOn(theme, 'resize').mockImplementation(() => {});
        theme.handleSettingsChanged({ renderScale: 0.75 });
        await flush();
        expect(resize).toHaveBeenCalledTimes(1);
    });

    it('sizes its canvas only when the size or the pixel ratio changes', () => {
        // Every save carries all the settings, the render scale with them, and sizing the canvas
        // again blanks it until the next frame.
        const theme = liveTheme();
        theme.camera = {};
        theme.renderer = { setPixelRatio: vi.fn(), setSize: vi.fn(), getDrawingBufferSize: vi.fn() };
        theme.resize(1280, 720);
        theme.resize(1280, 720);
        expect(theme.renderer.setSize).toHaveBeenCalledTimes(1);
        expect(theme.renderer.setPixelRatio).toHaveBeenCalledTimes(1);
        vi.spyOn(theme, 'getEffectivePixelRatio').mockReturnValue(0.5);
        theme.resize(1280, 720);
        expect(theme.renderer.setPixelRatio).toHaveBeenLastCalledWith(0.5);
        expect(theme.renderer.setSize).toHaveBeenCalledTimes(2);
    });
});
