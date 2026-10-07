import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';
import { OdysseyOpponentBoard } from '../../src/rendering/phaser/odyssey-opponent-board.js';
import { resetOdysseyRoundPresentation } from '../../src/rendering/phaser/odyssey-board-presentation.js';

/** A scene clock and tween manager that retain queued callbacks after cancellation. */
function makeScene({ colorFilter = true, reducedMotion = false } = {}) {
    const resources = [];
    const timers = [];
    const animations = [];
    const gameState = {
        settings: { reducedMotion },
        boardGrid: Array.from({ length: 24 }, () => Array(10).fill(null)),
    };
    gameState.boardGrid[23][4] = { type: 'GARBAGE', color: '#4a5068' };
    const filter = { colorMatrix: { reset: vi.fn(), saturate: vi.fn(), brightness: vi.fn() } };
    const camera = {
        alpha: 1,
        setAlpha: vi.fn(function setAlpha(alpha) { this.alpha = alpha; }),
        filters: { internal: { addColorMatrix: () => (colorFilter ? filter : null), remove: vi.fn() } },
    };
    let scene;
    const object = (kind) => {
        const listeners = new Map();
        const resource = {
            kind,
            scene,
            scale: 1,
            scaleX: 1,
            scaleY: 1,
            destroyed: false,
            once(name, callback) { listeners.set(name, callback); return this; },
            destroy: vi.fn(() => {
                if (resource.destroyed) return;
                resource.destroyed = true;
                resource.scene = null;
                listeners.get('destroy')?.();
            }),
        };
        ['setOrigin', 'setDisplaySize', 'setTint', 'setAlpha', 'setDepth', 'setScrollFactor',
            'setBlendMode', 'clear', 'fillStyle', 'fillRect', 'explode'].forEach((name) => {
            resource[name] = vi.fn(() => resource);
        });
        resources.push(resource);
        return resource;
    };
    scene = {
        resources,
        timers,
        animations,
        gameState,
        cols: 10,
        rows: 20,
        hiddenRows: 4,
        blockSize: 40,
        sys: { isActive: () => true },
        cameras: { main: camera },
        textures: { exists: () => true },
        shakeCamera: vi.fn(),
        setEffectQuality: vi.fn(),
        clearBoard: vi.fn(),
        syncFromGameState: vi.fn((state) => { scene.gameState = state; }),
        add: {
            image: (x, y, key) => Object.assign(object('image'), { x, y, key }),
            graphics: () => object('graphics'),
            particles: () => object('emitter'),
        },
        time: {
            delayedCall: (ms, callback) => {
                const timer = { callback, hasDispatched: false };
                const timeout = setTimeout(() => {
                    timer.hasDispatched = true;
                    callback();
                }, ms);
                timer.remove = vi.fn(() => clearTimeout(timeout));
                timers.push(timer);
                return timer;
            },
        },
        tweens: {
            add: (config) => {
                const animation = { config, completed: false };
                const timeout = setTimeout(() => {
                    animation.completed = true;
                    const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
                    targets.forEach((target) => {
                        ['h', 't', 'alpha', 'scale', 'scaleY', 'x', 'y', 'angle'].forEach((property) => {
                            if (Number.isFinite(config[property])) target[property] = config[property];
                        });
                    });
                    config.onUpdate?.();
                    config.onComplete?.();
                }, (config.delay || 0) + (config.duration || 0));
                animation.remove = vi.fn(() => clearTimeout(timeout));
                animation.destroy = vi.fn(() => clearTimeout(timeout));
                animations.push(animation);
                return animation;
            },
            killTweensOf: vi.fn((target) => {
                animations.filter(({ config }) => config.targets === target)
                    .forEach((animation) => animation.remove());
            }),
        },
    };
    scene.sharedEffects = new SharedEffects(scene);
    scene.sharedEffects._reducedMotion = () => reducedMotion;
    return scene;
}

function makeRound(options) {
    const human = makeScene(options);
    const bot = makeScene(options);
    const observer = new OdysseyOpponentBoard();
    Object.assign(observer, {
        disposed: false,
        scene: bot,
        gameState: bot.gameState,
        juice: { reset: vi.fn() },
    });
    const session = {
        duel: { players: [human.gameState, bot.gameState] },
        opponentBoard: observer,
        boardPresentation: { syncSettings: vi.fn() },
    };
    const mode = {
        _getBoardScene: () => human,
        boardJuice: { reset: vi.fn() },
        _odysseyBoardLayout: { update: vi.fn() },
    };
    return {
        human, bot, observer, session, reset: () => resetOdysseyRoundPresentation(mode, session),
    };
}

function invokeQueuedCallbacks(scene) {
    scene.timers.slice().forEach(({ callback }) => callback());
    scene.animations.slice().forEach(({ config }) => {
        config.onUpdate?.();
        config.onComplete?.();
    });
}

describe('Odyssey round effect ownership', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('removes both wells\' previous effects at the actual 900 ms round boundary', () => {
        const round = makeRound();
        round.human.sharedEffects.playKnockout();
        round.bot.sharedEffects.playRoundWin();
        vi.advanceTimersByTime(900);
        const veil = round.human.resources.find(({ kind }) => kind === 'graphics');
        expect(veil.destroyed).toBe(false);
        expect(veil.fillRect).toHaveBeenCalled();
        expect(round.bot.resources.filter(({ kind }) => kind === 'emitter')).toHaveLength(2);
        expect(round.bot.resources.some((resource) => !resource.destroyed)).toBe(true);

        round.reset();

        [round.human, round.bot].forEach((scene) => {
            expect(scene.resources.every(({ destroyed }) => destroyed)).toBe(true);
            scene.timers.filter(({ hasDispatched }) => !hasDispatched)
                .forEach(({ remove }) => expect(remove).toHaveBeenCalled());
            scene.animations.filter(({ completed }) => !completed)
                .forEach(({ remove, destroy }) => {
                    expect(remove).toHaveBeenCalled();
                    expect(destroy).toHaveBeenCalled();
                });
        });
        expect(round.human.cameras.main.alpha).toBe(1);
        expect(round.human.cameras.main.filters.internal.remove).toHaveBeenCalled();
        vi.advanceTimersByTime(3000);
        expect(round.bot.resources.filter(({ kind }) => kind === 'emitter')).toHaveLength(2);
    });

    it('fences callbacks already queued from a retired round while the fresh round still animates', () => {
        const round = makeRound();
        round.human.sharedEffects.playKnockout();
        round.bot.sharedEffects.playVictory();
        vi.advanceTimersByTime(100);
        const humanCount = round.human.resources.length;
        const botCount = round.bot.resources.length;
        const veil = round.human.resources.find(({ kind }) => kind === 'graphics');
        round.reset();

        invokeQueuedCallbacks(round.human);
        invokeQueuedCallbacks(round.bot);
        expect(round.human.resources).toHaveLength(humanCount);
        expect(round.bot.resources).toHaveLength(botCount);
        expect(veil.fillRect).not.toHaveBeenCalled();

        round.bot.sharedEffects.playRoundWin();
        vi.advanceTimersByTime(600);
        expect(round.bot.resources.filter(({ kind }) => kind === 'emitter')).toHaveLength(1);
        expect(round.bot.resources.slice(botCount).some((resource) => !resource.destroyed)).toBe(true);
        round.reset();
    });

    it.each([false, true])('restores a knockout without camera color-filter support (reduced motion %s)', (reducedMotion) => {
        const round = makeRound({ colorFilter: false, reducedMotion });
        round.human.sharedEffects.playKnockout();
        vi.advanceTimersByTime(900);
        // A camera can be partway through the alpha tween when the round resets.
        round.human.cameras.main.alpha = 0.7;
        round.reset();

        expect(round.human.cameras.main.alpha).toBe(1);
        expect(round.human.resources.every(({ destroyed }) => destroyed)).toBe(true);
        invokeQueuedCallbacks(round.human);
        vi.advanceTimersByTime(2000);
        expect(round.human.cameras.main.alpha).toBe(1);
    });
});
