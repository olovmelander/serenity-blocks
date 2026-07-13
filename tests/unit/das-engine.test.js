/**
 * §5.4 DAS engine pins: hand-computed golden repeat tables for the one pure
 * engine, plus adapter-contract tests proving the legacy millisecond callers
 * forward their state/config without changing public return or lifecycle
 * semantics. The adapters deliberately retain their existing clock ownership.
 */
import { describe, it, expect } from 'vitest';
import {
    createDasDirectionState, createSoftDropState, startDas, stopDas, clearDasTimers,
    advanceDas, advanceSoftDrop,
} from '../../src/core/das.js';
import { InputController } from '../../src/ui/controls.js';
import { GamepadController } from '../../src/ui/gamepad-controller.js';
import { RandomStream } from '../../src/core/rng.js';
import { COLS, ROWS } from '../../src/core/constants.js';

const CFG = { dasDelay: 120, dasInterval: 40, instantLimit: COLS };

function heldState() {
    const s = createDasDirectionState();
    startDas(s);
    return s;
}

function runDasStep(state, delta, config, blockAfter) {
    let moves = 0;
    advanceDas(state, delta, config, () => {
        moves += 1;
        return moves < blockAfter;
    });
    return moves;
}

function runSoftDropStep(state, delta, config, blockAfter) {
    let moves = 0;
    advanceSoftDrop(state, delta, config, () => {
        moves += 1;
        return moves < blockAfter;
    });
    return moves;
}

describe('advanceDas golden tables (§5.4)', () => {
    it('16ms frames, delay 120 / interval 40: first repeat on frame 8, then every ~40ms', () => {
        const s = heldState();
        const firedPerFrame = [];
        for (let f = 0; f < 13; f += 1) {
            firedPerFrame.push(advanceDas(s, 16, CFG, () => {}));
        }
        // delay accumulates 16..112 over frames 1-7 (no fires); frame 8 → 128 ≥ 120:
        // threshold repeat fires with 8ms overshoot carried; then every 40ms.
        expect(firedPerFrame).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]);
    });

    it('lag spike: one 300ms delta fires the threshold repeat + owed catch-ups', () => {
        const s = heldState();
        // overshoot = 300-120 = 180 → 1 threshold fire + 4 catch-ups (180/40), 20ms carry
        expect(advanceDas(s, 300, CFG, () => {})).toBe(5);
        expect(s.intervalAccumulator).toBe(20);
        expect(s.isRepeating).toBe(true);
    });

    it('instant DAS (interval <= 0): fires to the wall, at most instantLimit', () => {
        const s = heldState();
        let wall = 3; // blocked after 3 moves
        const fired = advanceDas(s, 200, { ...CFG, dasInterval: 0 }, () => { wall -= 1; return wall > 0; });
        expect(fired).toBe(3);
        const s2 = heldState();
        expect(advanceDas(s2, 200, { ...CFG, dasInterval: 0 }, () => {})).toBe(COLS);
    });

    it('inactive or stopped state never fires', () => {
        const s = createDasDirectionState();
        expect(advanceDas(s, 1000, CFG, () => {})).toBe(0);
        const s2 = heldState();
        stopDas(s2);
        expect(advanceDas(s2, 1000, CFG, () => {})).toBe(0);
    });

    it('clearDasTimers keeps the hold but prevents a resume burst', () => {
        const s = heldState();
        advanceDas(s, 300, CFG, () => {}); // deep into repeating
        clearDasTimers(s);
        expect(s.active).toBe(true);
        // After a clear the full delay must elapse again before any repeat.
        expect(advanceDas(s, 119, CFG, () => {})).toBe(0);
        expect(advanceDas(s, 1, CFG, () => {})).toBe(1);
    });

    it('soft drop: no delay phase, interval loop + instant mode', () => {
        const s = createSoftDropState();
        s.active = true;
        expect(advanceSoftDrop(s, 49, { softDropInterval: 50, instantLimit: ROWS }, () => {})).toBe(0);
        expect(advanceSoftDrop(s, 51, { softDropInterval: 50, instantLimit: ROWS }, () => {})).toBe(2); // 100ms owed
        const inst = createSoftDropState();
        inst.active = true;
        let floor = 5;
        const instFired = advanceSoftDrop(inst, 16, { softDropInterval: 0, instantLimit: ROWS }, () => {
            floor -= 1; return floor > 0;
        });
        expect(instFired).toBe(5);
    });
});

describe('legacy keyboard DAS adapter contract', () => {
    it('forwards 500 random direction sequences with exact state and action counts', () => {
        const rng = new RandomStream('das-5.4', 'directions');
        const ic = new InputController();
        for (let caseIdx = 0; caseIdx < 500; caseIdx += 1) {
            const config = {
                dasDelay: [0, 40, 120, 170, 300][rng.nextInt(5)],
                dasInterval: [0, 10, 40, 50, 100][rng.nextInt(5)],
                instantLimit: COLS,
            };
            const engineState = heldState();
            const legacyState = heldState();
            const steps = 1 + rng.nextInt(12);
            for (let i = 0; i < steps; i += 1) {
                const delta = rng.nextInt(101); // legacy clamps to [0,100]
                const blockAfter = rng.nextInt(4) === 0 ? rng.nextInt(3) : Infinity;
                let engineMoves = 0;
                let legacyMoves = 0;
                advanceDas(engineState, delta, config, () => {
                    engineMoves += 1; return engineMoves < blockAfter;
                });
                ic.processDasDirection(legacyState, config.dasDelay, config.dasInterval, delta, () => {
                    legacyMoves += 1; return legacyMoves < blockAfter;
                });
                expect(engineMoves, `case ${caseIdx} step ${i} (cfg ${JSON.stringify(config)})`).toBe(legacyMoves);
            }
            expect(engineState, `case ${caseIdx} final state`).toEqual(legacyState);
        }
    });

    it('forwards 300 random soft-drop sequences with exact state and action counts', () => {
        const rng = new RandomStream('das-5.4', 'softdrop');
        const ic = new InputController();
        for (let caseIdx = 0; caseIdx < 300; caseIdx += 1) {
            const interval = [0, 20, 50, 80][rng.nextInt(4)];
            const engineState = createSoftDropState();
            engineState.active = true;
            const legacyState = createSoftDropState();
            legacyState.active = true;
            const steps = 1 + rng.nextInt(10);
            for (let i = 0; i < steps; i += 1) {
                const delta = rng.nextInt(101);
                const blockAfter = rng.nextInt(4) === 0 ? rng.nextInt(3) : Infinity;
                let engineMoves = 0;
                let legacyMoves = 0;
                advanceSoftDrop(engineState, delta, { softDropInterval: interval, instantLimit: ROWS }, () => {
                    engineMoves += 1; return engineMoves < blockAfter;
                });
                ic.processSoftDrop(legacyState, interval, delta, () => {
                    legacyMoves += 1; return legacyMoves < blockAfter;
                });
                expect(engineMoves, `case ${caseIdx} step ${i} (interval ${interval})`).toBe(legacyMoves);
            }
            expect(engineState, `case ${caseIdx} final state`).toEqual(legacyState);
        }
    });

    it('preserves undefined returns and the regular-versus-instant false contract', () => {
        const controller = new InputController();
        const regular = heldState();
        let regularMoves = 0;
        const regularResult = controller.processDasDirection(regular, 0, 10, 30, () => {
            regularMoves += 1;
            return false;
        });
        expect(regularResult).toBeUndefined();
        expect(regularMoves).toBe(4);

        const instant = heldState();
        let instantMoves = 0;
        const instantResult = controller.processDasDirection(instant, 0, 0, 30, () => {
            instantMoves += 1;
            return false;
        });
        expect(instantResult).toBeUndefined();
        expect(instantMoves).toBe(1);

        const softDrop = createSoftDropState();
        softDrop.active = true;
        expect(controller.processSoftDrop(softDrop, 10, 30, () => false)).toBeUndefined();
    });
});

describe('legacy gamepad DAS adapter contract', () => {
    it('forwards cached-config direction and soft-drop timers', () => {
        const rng = new RandomStream('das-5.4', 'gamepad');
        const controller = new GamepadController();
        controller.enabled = true;
        controller.gameActions = {};

        for (let caseIdx = 0; caseIdx < 200; caseIdx += 1) {
            const config = {
                dasDelay: [0, 40, 120, 170][rng.nextInt(4)],
                dasInterval: [0, 10, 40, 80][rng.nextInt(4)],
                softDropInterval: [0, 20, 50, 90][rng.nextInt(4)],
            };
            controller.updateDasSettings(
                config.dasDelay,
                config.dasInterval,
                config.softDropInterval,
            );

            const directionState = heldState();
            const softDropState = createSoftDropState();
            softDropState.active = true;
            let gamepadDirectionMoves = 0;
            let gamepadSoftDropMoves = 0;
            let directionBlockAfter = Infinity;
            let softDropBlockAfter = Infinity;
            controller.startDas(0, 'left', () => {
                gamepadDirectionMoves += 1;
                return gamepadDirectionMoves < directionBlockAfter;
            });
            controller.startDas(0, 'down', () => {
                gamepadSoftDropMoves += 1;
                return gamepadSoftDropMoves < softDropBlockAfter;
            });

            const steps = 1 + rng.nextInt(12);
            for (let step = 0; step < steps; step += 1) {
                const delta = rng.nextInt(101);
                directionBlockAfter = rng.nextInt(4) === 0 ? 1 + rng.nextInt(3) : Infinity;
                softDropBlockAfter = rng.nextInt(4) === 0 ? 1 + rng.nextInt(3) : Infinity;
                const engineDirectionMoves = runDasStep(directionState, delta, {
                    ...config,
                    instantLimit: COLS,
                }, directionBlockAfter);
                const engineSoftDropMoves = runSoftDropStep(softDropState, delta, {
                    softDropInterval: config.softDropInterval,
                    instantLimit: ROWS,
                }, softDropBlockAfter);
                controller.processDasTimers(0, delta);

                expect(gamepadDirectionMoves, `direction case ${caseIdx} step ${step}`)
                    .toBe(engineDirectionMoves);
                expect(gamepadSoftDropMoves, `soft drop case ${caseIdx} step ${step}`)
                    .toBe(engineSoftDropMoves);
                gamepadDirectionMoves = 0;
                gamepadSoftDropMoves = 0;
            }

            expect(controller.dasState[0].left).toMatchObject(directionState);
            expect(controller.dasState[0].down).toMatchObject(softDropState);
        }
    });

    it('applies explicit config updates on the next advance and keeps clear-as-stop semantics', () => {
        const controller = new GamepadController();
        controller.enabled = true;
        controller.gameActions = {};
        controller.updateDasSettings(20, 10, 10);
        let moves = 0;
        controller.startDas(0, 'left', () => {
            moves += 1;
            return false;
        });

        expect(controller.processDasTimers(0, 10)).toBeUndefined();
        expect(moves).toBe(0);

        controller.updateDasSettings(10, 0, 10);
        expect(controller.processDasTimers(0, 0)).toBeUndefined();
        expect(moves).toBe(1);

        controller.clearDasTimers(0);
        expect(controller.dasState[0].left.active).toBe(false);
        expect(controller.dasState[0].right.active).toBe(false);
        expect(controller.dasState[0].down.active).toBe(false);
    });

    it('keeps the null-action guard and uses the no-delay soft-drop path', () => {
        const controller = new GamepadController();
        controller.enabled = true;
        controller.gameActions = {};
        controller.updateDasSettings(120, 40, 0);
        controller.dasState[0].left.active = true;
        let drops = 0;
        controller.startDas(0, 'down', () => {
            drops += 1;
            return false;
        });

        controller.processDasTimers(0, 1);

        expect(controller.dasState[0].left.isRepeating).toBe(false);
        expect(drops).toBe(1);
    });
});
