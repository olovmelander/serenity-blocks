import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { GameplayHybridEngine } from '../../src/core/odyssey/GameplayHybridEngine.js';
import { getLevelById } from '../../src/core/odyssey/data/levels.js';
import {
    configureOdysseyBoardPresentation, prepareOdysseyOpponentPresentation,
} from '../../src/rendering/phaser/odyssey-board-presentation.js';

function fixture(id = 1) {
    const engine = new GameplayHybridEngine();
    engine.configure(getLevelById(id));
    const session = { gameState: engine.createGameState() };
    const scene = Object.fromEntries([
        'setWellStyle', 'setEffectQuality', 'configureCamera', 'updateCameraPosition',
    ].map((name) => [name, vi.fn()]));
    const settings = { effectQuality: 'Low', reducedMotion: false };
    const juice = { disabled: false, reset: vi.fn() };
    const options = {
        scene, session, settingsManager: { get: () => settings }, getJuice: () => juice,
    };
    return {
        session, scene, settings, juice, owner: configureOdysseyBoardPresentation(options), options,
    };
}

describe('Odyssey shared board presentation', () => {
    beforeEach(() => {
        const browserWindow = new EventTarget();
        browserWindow.matchMedia = () => ({ matches: false });
        vi.stubGlobal('window', browserWindow);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('enables the canonical well and configured quality without changing gameplay', () => {
        const { session, scene, owner } = fixture();
        expect(scene.setWellStyle).toHaveBeenCalledWith(true);
        expect(scene.setEffectQuality).toHaveBeenCalledWith('Low');
        expect(session.gameState.piecesPlaced).toBe(0);
        expect(session.gameState.currentPiece).toBeNull();
        expect(session.gameState.settings).toEqual({ reducedMotion: false });
        owner.dispose();
    });

    it('frames real seeded garbage while keeping simulation camera ownership unchanged', () => {
        const { session, scene, owner } = fixture(56);
        expect(scene.updateCameraPosition).toHaveBeenCalledWith(54, true);
        expect(session.gameState.cameraRow).toBe(54);
        expect(session.gameState.lockedPieces).toHaveLength(30);
        owner.dispose();
    });

    it('responds to live quality and reduced-motion settings in effects and board motion', () => {
        const {
            session, scene, settings, juice, owner,
        } = fixture();
        settings.effectQuality = 'Minimal';
        settings.reducedMotion = true;
        window.dispatchEvent(new Event('settingsChanged'));
        expect(scene.setEffectQuality).toHaveBeenLastCalledWith('Minimal');
        expect(session.gameState.settings.reducedMotion).toBe(true);
        expect(juice.disabled).toBe(true);
        expect(juice.reset).toHaveBeenCalledOnce();
        settings.reducedMotion = false;
        window.dispatchEvent(new Event('settingsChanged'));
        expect(juice.disabled).toBe(false);
        owner.dispose();
    });

    it('honors OS reduced motion at initialization', () => {
        window.matchMedia = () => ({ matches: true });
        const { session, juice, owner } = fixture();
        expect(session.gameState.settings.reducedMotion).toBe(true);
        expect(juice.disabled).toBe(true);
        owner.dispose();
    });

    it('removes stale settings listeners when the same scene gains a replacement attempt', () => {
        const first = fixture();
        const secondSession = { gameState: { settings: {}, isInfinityMode: false } };
        const secondSettings = { effectQuality: 'High', reducedMotion: true };
        const second = configureOdysseyBoardPresentation({
            scene: first.scene, session: secondSession, settingsManager: { get: () => secondSettings },
        });
        first.settings.reducedMotion = true;
        window.dispatchEvent(new Event('settingsChanged'));
        expect(first.session.gameState.settings.reducedMotion).toBe(false);
        expect(secondSession.gameState.settings.reducedMotion).toBe(true);
        first.owner.dispose();
        secondSettings.reducedMotion = false;
        window.dispatchEvent(new Event('settingsChanged'));
        expect(secondSession.gameState.settings.reducedMotion).toBe(false);
        second.dispose();
        secondSettings.reducedMotion = true;
        window.dispatchEvent(new Event('settingsChanged'));
        expect(secondSession.gameState.settings.reducedMotion).toBe(false);
    });

    it('destroys an opponent that finishes preparation after its attempt is retired', async () => {
        let resolve;
        const pending = new Promise((finish) => { resolve = finish; });
        let active = true;
        const observer = { dispose: vi.fn() };
        const session = { duel: { players: [{}, {}], setPresentation: vi.fn() } };
        const mode = {
            _isLevelSessionActive: () => active,
            odysseyHUD: { prepareOpponentBoard: () => pending },
        };
        const preparing = prepareOdysseyOpponentPresentation(mode, session);
        active = false;
        resolve(observer);
        expect(await preparing).toBe(false);
        expect(observer.dispose).toHaveBeenCalledOnce();
        expect(session.duel.setPresentation).not.toHaveBeenCalled();
        expect(mode.boardScenes).toBeUndefined();
    });
});
