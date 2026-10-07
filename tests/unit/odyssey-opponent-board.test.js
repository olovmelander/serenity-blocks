/* eslint-disable import/first */
import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';

const fixture = vi.hoisted(() => ({
    games: [], scenes: [], juices: [], listeners: new Map(),
}));

vi.mock('phaser', () => ({
    default: {
        WEBGL: 'webgl',
        Scale: { FIT: 'fit', CENTER_BOTH: 'center' },
        Game: function Game(config) {
            this.config = config;
            this.isRunning = false;
            this.destroy = vi.fn();
            this.loop = {
                running: false,
                sleep: vi.fn(() => { this.loop.running = false; }),
                wake: vi.fn(() => { this.loop.running = true; }),
            };
            this.boot = () => {
                this.isRunning = true;
                this.loop.running = true;
                config.scene[0].init();
                config.scene[0].create();
            };
            fixture.games.push(this);
        },
    },
}));

vi.mock('../../src/rendering/phaser/multiplayer/board-panel.js', () => ({
    createMultiplayerBoardScene: vi.fn(() => function CanonicalBoardScene(key, boardConfig) {
        this.key = key;
        this.boardConfig = boardConfig;
        this.sharedEffects = Object.fromEntries([
            'cleanup', 'clearKnockout', 'playHardDropEffect', 'playPerfectClear', 'playTSpinEffect',
            'playB2BChange', 'playLevelUp', 'playGarbageArrival', 'playKnockout', 'playRoundWin', 'playVictory',
            'showCascadeWave',
        ].map((method) => [method, vi.fn()]));
        for (const method of [
            'setWellStyle', 'setEffectQuality', 'setPresentationPaused', 'syncFromGameState', 'clearBoard',
            'createPieceLockRipple', 'triggerLineClearFlash', 'playLineClearImpact', 'showComboPopup',
        ]) this[method] = vi.fn();
        this.create = () => {};
        this.init = vi.fn((data) => {
            this.viewport = data.viewport;
            this.playerId = data.playerId;
        });
        fixture.scenes.push(this);
    }),
}));

vi.mock('../../src/rendering/phaser/board-juice.js', () => ({
    BoardJuice: function Juice(element) {
        this.element = element;
        for (const method of ['nudge', 'tilt', 'dip', 'bounce', 'pulse', 'reset', 'destroy']) {
            this[method] = vi.fn();
        }
        fixture.juices.push(this);
    },
}));

vi.mock('../../src/rendering/phaser/frame-rate-policy.js', () => ({
    phaserBoardRuntimeConfig: () => ({ audio: { noAudio: true }, fps: { target: 60 } }),
    applyPhaserFrameRate: vi.fn(),
}));

import { OdysseyOpponentBoard } from '../../src/rendering/phaser/odyssey-opponent-board.js';
import { createMultiplayerBoardScene } from '../../src/rendering/phaser/multiplayer/board-panel.js';
import { OdysseyHUD } from '../../src/ui/odyssey/OdysseyHUD.js';

function createObserver() {
    const settings = { effectQuality: 'Low', reducedMotion: false, targetFrameRate: 60 };
    let current = true;
    const observer = new OdysseyOpponentBoard({
        deps: { settingsManager: { get: () => settings } },
        isCurrent: () => current,
    });
    const state = {
        boardGrid: Array.from({ length: 24 }, () => Array(10).fill(null)),
        currentPiece: {
            x: 3, y: 4, shape: [[1]], color: '#ffaa00',
        },
        lockedPieces: [],
        settings: { retainedInputSetting: true },
    };
    const parent = { parentElement: { id: 'well' } };
    return {
        observer, state, parent, settings, retire: () => { current = false; },
    };
}

async function prepare(harness) {
    const pending = harness.observer.prepare(harness.parent, harness.state);
    await vi.waitFor(() => expect(fixture.games).toHaveLength(1));
    fixture.games[0].boot();
    expect(await pending).toBe(true);
    return fixture.scenes[0];
}

describe('Odyssey canonical opponent observer', () => {
    beforeEach(() => {
        fixture.games.length = 0;
        fixture.scenes.length = 0;
        fixture.juices.length = 0;
        fixture.listeners.clear();
        vi.stubGlobal('window', {
            matchMedia: () => ({ matches: false }),
            addEventListener: (name, callback) => fixture.listeners.set(name, callback),
            removeEventListener: (name, callback) => {
                if (fixture.listeners.get(name) === callback) fixture.listeners.delete(name);
            },
        });
    });

    afterEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('hosts one canonical well scene and observes actual board state without advancing gameplay', async () => {
        const harness = createObserver();
        const before = JSON.stringify(harness.state);
        const scene = await prepare(harness);

        expect(createMultiplayerBoardScene).toHaveBeenCalledTimes(1);
        expect(scene.boardConfig).toEqual({
            cols: 10, rows: 20, hiddenRows: 4, blockSize: 40,
        });
        expect(fixture.games[0].config).toMatchObject({
            width: 400,
            height: 800,
            parent: harness.parent,
            transparent: true,
            audio: { noAudio: true },
            scale: { mode: 'fit', autoCenter: 'center' },
        });
        expect(scene.setWellStyle).toHaveBeenCalledWith(true);
        expect(scene.viewport).toEqual({
            x: 0, y: 0, width: 400, height: 800,
        });
        expect(scene.playerId).toBe(2);
        expect(scene.setEffectQuality).toHaveBeenCalledWith('Low');
        expect(scene.syncFromGameState).toHaveBeenLastCalledWith(harness.state);
        expect(fixture.juices[0].element).toBe(harness.parent.parentElement);
        harness.observer.update();
        expect(JSON.stringify(harness.state)).toBe(JSON.stringify({
            ...JSON.parse(before), settings: { retainedInputSetting: true, reducedMotion: false },
        }));
        harness.observer.dispose();
    });

    it('routes moves, drops, clears and outcomes through canonical visual APIs', async () => {
        const harness = createObserver();
        const scene = await prepare(harness);
        const callbacks = harness.observer.getVisualCallbacks();
        const piece = harness.state.currentPiece;
        const drop = { piece, startY: 4, endY: 20 };
        callbacks.onMove(-1);
        callbacks.onRotate('right');
        callbacks.onHardDrop(drop);
        callbacks.onPieceLock(piece);
        callbacks.onLineClearImpact(4, 3);
        callbacks.triggerFlash([20, 21, 22, 23]);
        callbacks.triggerCombo(3);
        callbacks.triggerCascadeWave(10);
        callbacks.onPerfectClear(3);
        callbacks.onGarbageApplied(4);
        callbacks.onTopOut();
        callbacks.onRoundWin();
        callbacks.onVictory();

        expect(fixture.juices[0].nudge.mock.calls).toEqual([[-0.5], [0, -0.5]]);
        expect(fixture.juices[0].tilt).toHaveBeenCalledWith(1.5);
        expect(fixture.juices[0].dip).toHaveBeenCalledWith(4);
        expect(scene.sharedEffects.playHardDropEffect).toHaveBeenCalledWith(drop);
        expect(scene.createPieceLockRipple).toHaveBeenCalledWith(piece);
        expect(scene.playLineClearImpact).toHaveBeenCalledWith(4, 3);
        expect(scene.triggerLineClearFlash).toHaveBeenCalledWith([20, 21, 22, 23]);
        expect(scene.showComboPopup).toHaveBeenCalledWith(3);
        expect(scene.sharedEffects.showCascadeWave).toHaveBeenCalledWith(10);
        expect(scene.sharedEffects.playPerfectClear).toHaveBeenCalledWith(3);
        expect(scene.sharedEffects.playGarbageArrival).toHaveBeenCalledWith(4);
        expect(scene.sharedEffects.playKnockout).toHaveBeenCalledTimes(1);
        expect(scene.sharedEffects.playRoundWin).toHaveBeenCalledTimes(1);
        expect(scene.sharedEffects.playVictory).toHaveBeenCalledTimes(1);
        harness.observer.dispose();
    });

    it('resets effects between rounds and prevents stale callbacks from animating the next board', async () => {
        const harness = createObserver();
        const scene = await prepare(harness);
        const stale = harness.observer.getVisualCallbacks();
        harness.observer.resetRound();
        stale.onGarbageApplied(5);
        harness.observer.getVisualCallbacks().onGarbageApplied(2);

        expect(scene.sharedEffects.cleanup).toHaveBeenCalledTimes(1);
        expect(scene.sharedEffects.clearKnockout).toHaveBeenCalledTimes(1);
        expect(scene.sharedEffects.playGarbageArrival.mock.calls).toEqual([[2]]);
        expect(scene.syncFromGameState).toHaveBeenLastCalledWith(harness.state);
        harness.retire();
        harness.observer.getVisualCallbacks().onTopOut();
        harness.observer.update();
        expect(scene.sharedEffects.playKnockout).not.toHaveBeenCalled();
        harness.observer.dispose();
    });

    it('freezes observer presentation for pause and applies live quality and reduced-motion settings', async () => {
        const harness = createObserver();
        const scene = await prepare(harness);
        harness.observer.setPaused(true);
        expect(fixture.games[0].loop.sleep).toHaveBeenCalledTimes(1);
        expect(scene.setPresentationPaused).toHaveBeenLastCalledWith(true);
        expect(fixture.juices[0].disabled).toBe(true);
        harness.settings.reducedMotion = true;
        harness.settings.effectQuality = 'Medium';
        fixture.listeners.get('settingsChanged')();
        harness.observer.setPaused(false);

        expect(fixture.games[0].loop.wake).toHaveBeenCalledTimes(1);
        expect(scene.setEffectQuality).toHaveBeenLastCalledWith('Medium');
        expect(harness.state.settings).toEqual({ retainedInputSetting: true, reducedMotion: true });
        expect(fixture.juices[0].disabled).toBe(true);
        harness.observer.dispose();
        expect(fixture.listeners.has('settingsChanged')).toBe(false);
    });

    it('cancels an in-flight boot and destroys its renderer before a stale scene can publish', async () => {
        const harness = createObserver();
        const pending = harness.observer.prepare(harness.parent, harness.state);
        await vi.waitFor(() => expect(fixture.games).toHaveLength(1));
        harness.observer.dispose();
        expect(await pending).toBe(false);
        fixture.games[0].boot();

        expect(harness.observer.scene).toBeNull();
        expect(fixture.scenes[0].syncFromGameState).not.toHaveBeenCalled();
        expect(fixture.games[0].destroy).toHaveBeenCalledWith(true);
        expect(fixture.juices[0].destroy).toHaveBeenCalledTimes(1);
    });

    it('wakes a sleeping renderer for Phaser to perform its deferred destruction', async () => {
        const harness = createObserver();
        await prepare(harness);
        harness.observer.setPaused(true);
        harness.observer.dispose();
        expect(fixture.games[0].destroy).toHaveBeenCalledWith(true);
        expect(fixture.games[0].loop.wake).toHaveBeenCalledTimes(1);
        expect(harness.observer.disposed).toBe(true);
    });

    it('latches a pause requested during boot without sleeping before create can resolve readiness', async () => {
        const harness = createObserver();
        const pending = harness.observer.prepare(harness.parent, harness.state);
        harness.observer.setPaused(true);
        await vi.waitFor(() => expect(fixture.games).toHaveLength(1));
        harness.observer.setPaused(true);
        expect(fixture.games[0].loop.sleep).not.toHaveBeenCalled();
        fixture.games[0].boot();

        expect(await pending).toBe(true);
        expect(fixture.scenes[0].setPresentationPaused).toHaveBeenLastCalledWith(true);
        expect(fixture.games[0].loop.sleep).toHaveBeenCalledTimes(1);
        expect(fixture.juices[0].disabled).toBe(true);
        harness.observer.dispose();
    });

    it('rejects readiness and releases the renderer if scene initialization throws', async () => {
        const harness = createObserver();
        const pending = harness.observer.prepare(harness.parent, harness.state);
        await vi.waitFor(() => expect(fixture.games).toHaveLength(1));
        const error = new Error('scene failed');
        fixture.scenes[0].syncFromGameState.mockImplementation(() => { throw error; });
        fixture.games[0].boot();

        await expect(pending).rejects.toBe(error);
        expect(fixture.games[0].destroy).toHaveBeenCalledWith(true);
        expect(harness.observer.disposed).toBe(true);
    });

    it('prepares the HUD opponent host with the same live state and current pause state', async () => {
        const harness = createObserver();
        const hud = Object.create(OdysseyHUD.prototype);
        Object.assign(hud, { botBoardHost: harness.parent, isPaused: true, opponentBoard: null });
        const pending = hud.prepareOpponentBoard(harness.state, {
            deps: { settingsManager: { get: () => harness.settings } },
        });
        await vi.waitFor(() => expect(fixture.games).toHaveLength(1));
        fixture.games[0].boot();
        const observer = await pending;

        expect(hud.getOpponentBoard()).toBe(observer);
        expect(observer.gameState).toBe(harness.state);
        expect(fixture.scenes[0].setPresentationPaused).toHaveBeenLastCalledWith(true);
        observer.dispose();
    });
});
