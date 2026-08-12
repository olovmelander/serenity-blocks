/**
 * Cross-mode board-effect parity tripwire.
 *
 * The four frequent beats (lock, clear, combo, cascade) drifted for months
 * because local MP and the mode classes wired them in unrelated places — and
 * fixes kept landing in LocalMultiplayerMode's DEAD builder while the live one
 * sat in main.js. Players preferred MP's leaner read; single player had grown
 * five extra layers.
 *
 * These tests pin the unification at the module level: every live builder now
 * routes the four beats through createBoardEffectHandlers, no builder
 * references the deleted single-player-only layers, and the beats behave
 * identically given the same scene.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createBoardEffectHandlers } from '../../src/core/game-modes/board-effect-callbacks.js';
import { SharedEffects } from '../../src/rendering/phaser/shared-effects.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(join(root, rel), 'utf-8');

const BUILDERS = {
    'main.js multiplayer builder': read('src/main.js'),
    SinglePlayerMode: read('src/core/game-modes/SinglePlayerMode.js'),
    'odyssey callbacks': read('src/core/game-modes/odyssey-physics-callbacks.js'),
    InfinityMode: read('src/core/game-modes/InfinityMode.js'),
};

describe('every live builder consumes the shared factory', () => {
    Object.entries(BUILDERS).forEach(([name, src]) => {
        it(`${name} delegates the four beats`, () => {
            expect(src).toMatch(/createBoardEffectHandlers/);
            ['lockBeat', 'clearFlashBeat', 'clearImpactBeat', 'comboBeat', 'cascadeWaveBeat']
                .forEach((beat) => expect(src).toContain(beat));
        });
    });

    it('no builder references the deleted single-player-only layers', () => {
        Object.values(BUILDERS).forEach((src) => {
            expect(src).not.toMatch(/playCollapseSettle/);
            expect(src).not.toMatch(/showCascadeStep/);
            expect(src).not.toMatch(/triggerBackgroundPulseCanvas\(/);
        });
    });

    it('the dead LocalMultiplayerMode builder stays deleted', () => {
        const src = read('src/core/game-modes/LocalMultiplayerMode.js');
        expect(src).not.toMatch(/_getPhysicsCallbacks\(playerNum\)\s*\{/);
        // The mode consumes ONLY the injected builder.
        expect(src).toMatch(/deps\.getMultiplayerPhysicsCallbacks/);
    });
});

describe('the beats behave identically across consumers', () => {
    /** A minimal live SharedEffects-backed scene, as every mode sees it. */
    function makeScene() {
        const scene = {
            calls: [],
            cols: 10,
            rows: 20,
            blockSize: 40,
            hiddenRows: 4,
            gameState: null,
            sharedEffects: null,
            createPieceLockRipple: vi.fn(),
            triggerLineClearFlash: vi.fn(),
            playLineClearImpact: vi.fn(),
            showComboPopup: vi.fn(),
        };
        scene.sharedEffects = {
            setComboCount: vi.fn(),
            showCascadeWave: vi.fn(),
        };
        return scene;
    }

    let sceneA;
    let sceneB;

    beforeEach(() => {
        sceneA = makeScene();
        sceneB = makeScene();
    });

    it('two independently-created handlers produce the same scene calls', () => {
        const a = createBoardEffectHandlers({ getScene: () => sceneA });
        const b = createBoardEffectHandlers({ getScene: () => sceneB });
        const run = (fx, scene) => {
            fx.lockBeat({ shape: [[1]], x: 3, y: 20 });
            fx.clearFlashBeat([20, 21]);
            fx.clearImpactBeat(2);
            fx.comboBeat(2);
            fx.cascadeWaveBeat(11);
            return {
                ripple: scene.createPieceLockRipple.mock.calls,
                flash: scene.triggerLineClearFlash.mock.calls,
                impact: scene.playLineClearImpact.mock.calls,
                popup: scene.showComboPopup.mock.calls,
                wave: scene.sharedEffects.showCascadeWave.mock.calls,
                tint: scene.sharedEffects.setComboCount.mock.calls,
            };
        };
        expect(run(a, sceneA)).toEqual(run(b, sceneB));
    });

    it('the combo popup number is cascade depth in every mode (local-MP semantics)', () => {
        const fx = createBoardEffectHandlers({ getScene: () => sceneA });
        fx.comboBeat(3);
        expect(sceneA.showComboPopup).toHaveBeenCalledWith(3);
    });
});

describe('SharedEffects honours the parity contracts', () => {
    it('showCascadeWave is silent below the mega threshold', () => {
        const scene = {
            cols: 10, rows: 20, blockSize: 40, hiddenRows: 4, gameState: null,
            textures: { exists: () => true },
            getQualityConfig: () => ({ particles: false }),
            time: { delayedCall: vi.fn(() => ({ remove() {} })) },
            tweens: { add: vi.fn() },
            shakeCamera: vi.fn(),
            add: { graphics: vi.fn(), text: vi.fn(), container: vi.fn(), rectangle: vi.fn(), particles: vi.fn() },
        };
        const fx = new SharedEffects(scene);
        [2, 5, 9].forEach((n) => fx.showCascadeWave(n));
        expect(scene.shakeCamera).not.toHaveBeenCalled();
        expect(scene.add.text).not.toHaveBeenCalled();
    });

    it('the settle beat no longer exists anywhere in the effect layer', () => {
        expect(SharedEffects.prototype.playCollapseSettle).toBeUndefined();
        expect(SharedEffects.prototype.showCascadeStep).toBeUndefined();
    });
});
