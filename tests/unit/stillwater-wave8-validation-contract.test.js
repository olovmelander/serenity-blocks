import { readFileSync } from 'fs';

import {
    describe,
    expect,
    it,
} from 'vitest';

import {
    evaluateStillwaterBoardCapture,
    evaluateStillwaterCaptureContinuity,
    evaluateStillwaterFrameBoardLifecycle,
    evaluateStillwaterHiddenLifecycle,
    STILLWATER_PHASER_CANVAS_FALLBACK_BLOCKER,
    STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS,
} from '../../scripts/stillwater-wave8-validation.mjs';

const validationSource = readFileSync(
    new URL('../../scripts/stillwater-wave8-validation.mjs', import.meta.url),
    'utf8',
);
const mainSource = readFileSync(
    new URL('../../src/main.js', import.meta.url),
    'utf8',
);

function createHiddenLifecycleInput(overrides = {}) {
    return {
        policy: 'explicit-app-pause',
        headed: false,
        backgroundThrottling: false,
        prepare: {
            ok: true,
            renderingPaused: true,
            explicitPauseInvoked: true,
        },
        hiddenStart: {
            visibility: {
                hidden: false,
                renderingPaused: true,
            },
        },
        hiddenEnd: {
            visibility: {
                hidden: false,
                renderingPaused: true,
            },
        },
        resume: {
            ok: true,
            renderingPaused: false,
            explicitResumeInvoked: true,
        },
        resumed: {
            visibility: {
                hidden: false,
                renderingPaused: false,
            },
            themeCanvasCount: 1,
        },
        nativeWindow: {
            visibleBefore: false,
            visibleWhileHidden: false,
            visibleAfter: false,
        },
        counterDeltas: {
            countersPresent: true,
            updates: 0,
            renders: 0,
        },
        ...overrides,
    };
}

describe('Stillwater Wave 8 validation contract', () => {
    it('accepts the explicit application-pause lane without an impossible hidden predicate', () => {
        const result = evaluateStillwaterHiddenLifecycle(
            createHiddenLifecycleInput(),
        );

        expect(result).toMatchObject({
            ok: true,
            policy: 'explicit-app-pause',
            backgroundThrottling: false,
            appPauseObserved: true,
            countersStable: true,
            resumedCleanly: true,
            nativeHideObserved: true,
        });
    });

    it('requires a genuine headed hidden-visible cycle in the Page Visibility lane', () => {
        const pageVisibilityInput = createHiddenLifecycleInput({
            policy: 'page-visibility',
            headed: true,
            backgroundThrottling: true,
            prepare: {
                ok: true,
                renderingPaused: false,
                explicitPauseInvoked: false,
            },
            hiddenStart: {
                visibility: {
                    hidden: true,
                    renderingPaused: true,
                },
            },
            hiddenEnd: {
                visibility: {
                    hidden: true,
                    renderingPaused: true,
                },
            },
            nativeWindow: {
                visibleBefore: true,
                visibleWhileHidden: false,
                visibleAfter: true,
            },
            resume: {
                ok: true,
                renderingPaused: false,
                explicitResumeInvoked: false,
            },
        });

        expect(evaluateStillwaterHiddenLifecycle(pageVisibilityInput).ok).toBe(true);
        expect(evaluateStillwaterHiddenLifecycle({
            ...pageVisibilityInput,
            hiddenEnd: {
                visibility: {
                    hidden: false,
                    renderingPaused: true,
                },
            },
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'document.hidden did not stay true for the hidden window',
            ]),
        });
    });

    it('rejects a production capture whenever the board is inactive or modal-blocked', () => {
        const validDiagnostics = {
            activeThemeName: 'stillwater',
            themeCanvasCount: 1,
            boardSurface: {
                ok: true,
                modeId: 'single',
                modeRunning: true,
                boardSceneActive: true,
                bodySerenityMode: false,
                blockingModal: null,
                gameOver: false,
                stopped: false,
                processingGameOver: false,
                pendingStop: false,
                activeSessionPresent: true,
                sessionOwnsGameState: true,
                sessionGeneration: 7,
                activeSessionGeneration: 7,
            },
        };

        expect(evaluateStillwaterBoardCapture(validDiagnostics).ok).toBe(true);
        expect(evaluateStillwaterBoardCapture({
            ...validDiagnostics,
            boardSurface: {
                ...validDiagnostics.boardSurface,
                ok: false,
                modeRunning: false,
                blockingModal: 'game-over-modal',
            },
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'production game mode is not running',
                'blocking modal is visible: game-over-modal',
                'boardSurface.ok is false',
            ]),
        });
    });

    it.each([
        ['gameOver', true, 'production game state is game-over'],
        ['stopped', true, 'production game state is stopped'],
        ['processingGameOver', true, 'game-over processing is pending'],
        ['pendingStop', true, 'mode stop is pending'],
        ['activeSessionPresent', false, 'active game session is missing'],
        ['sessionOwnsGameState', false, 'active session does not own game state'],
    ])('rejects terminal or unowned board state: %s', (field, value, reason) => {
        const diagnostics = {
            activeThemeName: 'stillwater',
            themeCanvasCount: 1,
            boardSurface: {
                ok: true,
                modeId: 'single',
                modeRunning: true,
                boardSceneActive: true,
                bodySerenityMode: false,
                blockingModal: null,
                gameOver: false,
                stopped: false,
                processingGameOver: false,
                pendingStop: false,
                activeSessionPresent: true,
                sessionOwnsGameState: true,
                sessionGeneration: 9,
                activeSessionGeneration: 9,
                [field]: value,
            },
        };

        expect(evaluateStillwaterBoardCapture(diagnostics)).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([reason]),
        });
    });

    it('requires an owned paused board throughout isolated frame capture and resumes it', () => {
        const state = (overrides = {}) => ({
            ok: true,
            modeId: 'single',
            modeRunning: true,
            modePaused: false,
            boardSceneActive: true,
            blockingModal: null,
            gameOver: false,
            stopped: false,
            processingGameOver: false,
            pendingStop: false,
            activeSessionPresent: true,
            sessionOwnsGameState: true,
            sessionGeneration: 14,
            activeSessionGeneration: 14,
            ...overrides,
        });
        const valid = {
            pauseApplied: true,
            before: state(),
            during: state({ modePaused: true }),
            after: state(),
        };

        expect(evaluateStillwaterFrameBoardLifecycle(valid).ok).toBe(true);
        expect(evaluateStillwaterFrameBoardLifecycle({
            ...valid,
            during: state({
                ok: false,
                modePaused: true,
                blockingModal: 'game-over-modal',
                gameOver: true,
            }),
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'during capture blocking modal is visible: game-over-modal',
                'during capture game state is game-over',
            ]),
        });
        expect(evaluateStillwaterFrameBoardLifecycle({
            ...valid,
            after: state({ modePaused: true }),
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'production board remained paused after isolated capture',
            ]),
        });
        expect(evaluateStillwaterFrameBoardLifecycle({
            ...valid,
            during: state({
                modePaused: true,
                sessionGeneration: 15,
                activeSessionGeneration: 15,
            }),
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'board session generation changed during isolated capture',
            ]),
        });
    });

    it('requires one healthy board generation across screenshot capture', () => {
        const diagnostics = (generation, overrides = {}) => ({
            activeThemeName: 'stillwater',
            themeCanvasCount: 1,
            boardSurface: {
                ok: true,
                modeId: 'single',
                modeRunning: true,
                boardSceneActive: true,
                bodySerenityMode: false,
                blockingModal: null,
                gameOver: false,
                stopped: false,
                processingGameOver: false,
                pendingStop: false,
                activeSessionPresent: true,
                sessionOwnsGameState: true,
                sessionGeneration: generation,
                activeSessionGeneration: generation,
                ...overrides,
            },
        });

        expect(evaluateStillwaterCaptureContinuity({
            recovery: { ok: true, expectedGeneration: 12 },
            preCapture: diagnostics(12),
            postCapture: diagnostics(12),
        }).ok).toBe(true);
        expect(evaluateStillwaterCaptureContinuity({
            recovery: { ok: true, expectedGeneration: 12 },
            preCapture: diagnostics(12),
            postCapture: diagnostics(13),
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'board session generation changed across screenshot capture',
            ]),
        });
        expect(evaluateStillwaterCaptureContinuity({
            recovery: { ok: true, expectedGeneration: 12 },
            preCapture: diagnostics(12),
            postCapture: diagnostics(12, {
                ok: false,
                blockingModal: 'game-over-modal',
            }),
        })).toMatchObject({
            ok: false,
            reasons: expect.arrayContaining([
                'post-capture: blocking modal is visible: game-over-modal',
            ]),
        });
    });

    it('pins the complete deterministic production-event capture matrix', () => {
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.map(({ id }) => id))
            .toEqual([
                'lock',
                'hard-drop',
                'line-clear',
                'tetris',
                'combo-4',
                'combo-7',
                'combo-10',
                't-spin',
                'back-to-back',
                'perfect-clear',
                'level-up',
            ]);
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .filter(({ preset }) => preset === 'combo')
            .map(({ comboCount }) => comboCount))
            .toEqual([4, 7, 10]);
        expect(new Set(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .map(({ id }) => id)).size)
            .toBe(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS.length);
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .find(({ preset }) => preset === 'harddrop'))
            .toMatchObject({ distance: 14 });
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .find(({ preset }) => preset === 'levelup'))
            .toMatchObject({ level: 12 });
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .find(({ preset }) => preset === 'b2b'))
            .toMatchObject({ expectedRouteIndex: 4 });
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .every(({ expectedRouteIndex }) => Number.isInteger(expectedRouteIndex)))
            .toBe(true);
        expect(Object.isFrozen(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS)).toBe(true);
        expect(STILLWATER_PRODUCTION_EVENT_CAPTURE_SPECS
            .every((spec) => Object.isFrozen(spec)))
            .toBe(true);
    });

    it('recovers and evaluates the production board around every synthetic capture', () => {
        const boardRecoveryCalls = validationSource.match(
            /recoverProductionBoardForCapture\(/g,
        ) || [];

        expect(boardRecoveryCalls.length).toBeGreaterThanOrEqual(4);
        expect(validationSource).toContain(
            ['`layout-$', '{layout}-recovery`'].join(''),
        );
        expect(validationSource).toContain(
            ['`resize-$', '{size.id}-recovery`'].join(''),
        );
        expect(validationSource).toContain(
            'blocking modal is visible:',
        );
        expect(validationSource).toContain(
            "makeCheck(\n            'layout_capture_matrix'",
        );
        expect(validationSource).toContain(
            "makeCheck(\n            'resize_dpr_matrix'",
        );
    });

    it('forces stable replacement sessions between long performance phases and captures', () => {
        const beforeState = validationSource.indexOf('const beforeState = readBoardState();');
        const firstHide = validationSource.indexOf(
            'hideBlockingModals();',
            beforeState,
        );
        const deactivate = validationSource.indexOf(
            'modeManager.deactivateCurrentMode()',
            firstHide,
        );
        const activate = validationSource.indexOf(
            "modeManager.activateMode('single')",
            deactivate,
        );
        const start = validationSource.indexOf(
            'modeManager.startCurrentMode({ seed: options.seed })',
            activate,
        );
        const stableWait = validationSource.indexOf(
            'await waitForStable(() => {',
            start,
        );
        const readyBoundary = validationSource.indexOf(
            'const ready = await waitForStable',
            start,
        );
        const lastRecoveryHide = validationSource.lastIndexOf(
            'hideBlockingModals();',
            readyBoundary,
        );

        expect(beforeState).toBeGreaterThan(-1);
        expect(firstHide).toBeGreaterThan(beforeState);
        expect(deactivate).toBeGreaterThan(firstHide);
        expect(activate).toBeGreaterThan(deactivate);
        expect(start).toBeGreaterThan(activate);
        expect(stableWait).toBeGreaterThan(start);
        expect(lastRecoveryHide).toBeLessThan(readyBoundary);
        expect(validationSource).toContain('replacementStateCreated');
        expect(validationSource).toContain('generationAdvanced');

        const preIdle = validationSource.indexOf("'pre-idle'");
        const idle = validationSource.indexOf(
            "'captureFrames(idle)'",
            preIdle,
        );
        const between = validationSource.indexOf(
            "'between-idle-reactions'",
            idle,
        );
        const reactions = validationSource.indexOf(
            "'captureFrames(reactions)'",
            between,
        );
        const reactionRecovery = validationSource.indexOf(
            "'reaction-screenshot'",
            reactions,
        );
        const reactionPng = validationSource.indexOf(
            "'stillwater-reactions.png'",
            reactionRecovery,
        );

        expect(preIdle).toBeGreaterThan(-1);
        expect(idle).toBeGreaterThan(preIdle);
        expect(between).toBeGreaterThan(idle);
        expect(reactions).toBeGreaterThan(between);
        expect(reactionRecovery).toBeGreaterThan(reactions);
        expect(reactionPng).toBeGreaterThan(reactionRecovery);
    });

    it('binds the final PNG to immediate same-generation diagnostics before CDP work', () => {
        const invalidate = validationSource.indexOf('win.webContents.invalidate?.();');
        const preCapture = validationSource.indexOf(
            "'collectPageDiagnostics(final-pre-capture)'",
        );
        const screenshot = validationSource.indexOf(
            "'stillwater-final-board.png'",
            preCapture,
        );
        const postCapture = validationSource.indexOf(
            "'collectPageDiagnostics(final)'",
            screenshot,
        );
        const finalMemory = validationSource.indexOf(
            "collectCdpDiagnostics(win, 'final', true)",
            postCapture,
        );

        expect(invalidate).toBeGreaterThan(-1);
        expect(preCapture).toBeGreaterThan(-1);
        expect(screenshot).toBeGreaterThan(preCapture);
        expect(postCapture).toBeGreaterThan(screenshot);
        expect(finalMemory).toBeGreaterThan(postCapture);
        expect(validationSource).toContain(
            'evaluateStillwaterCaptureContinuity({',
        );
        expect(validationSource).toContain(
            'board session generation changed across screenshot capture',
        );
    });

    it('isolates event captures and gates console, fixed resources, and renderer memory', () => {
        const eventRecovery = validationSource.indexOf(
            '`production-event-${spec.id}-recovery`',
        );
        const forcedFreshEventSession = validationSource.indexOf(
            'forceRestart: true,',
            eventRecovery,
        );

        expect(eventRecovery).toBeGreaterThan(-1);
        expect(forcedFreshEventSession).toBeGreaterThan(eventRecovery);
        expect(validationSource).toContain(
            'prepareProductionEventCapturePage',
        );
        expect(validationSource).toContain(
            'finishProductionEventCapturePage',
        );
        expect(validationSource).toContain(
            'identityStable',
        );
        expect(validationSource).toContain(
            'rendererMemoryStable',
        );
        expect(validationSource).toContain(
            'perEventResourceCreation === 0',
        );
        expect(validationSource).toContain(
            'shaderPipelineFailureCount === 0',
        );
        expect(validationSource).toContain(
            "'production_event_capture_matrix'",
        );
    });

    it('keeps real Page Visibility isolated from the production pause-policy lane', () => {
        expect(validationSource).toContain(
            'backgroundThrottling: CONFIG.pageVisibilityLane',
        );
        expect(validationSource).toContain(
            'if (!CONFIG.pageVisibilityLane) {',
        );
        expect(validationSource).toContain(
            "app.commandLine.appendSwitch('disable-renderer-backgrounding')",
        );
        expect(validationSource).toContain(
            "policy === 'explicit-app-pause'",
        );
    });

    it('reports the Phaser Canvas board limitation without gating it by default', () => {
        expect(STILLWATER_PHASER_CANVAS_FALLBACK_BLOCKER).toMatchObject({
            supported: false,
            code: 'phaser4-production-board-is-webgl-only',
        });
        expect(mainSource).toContain('type: PhaserRef.WEBGL');
        expect(mainSource).toContain('Phaser 4 is WebGL-only (no Canvas renderer)');
        expect(mainSource).toContain('there is no');
        expect(mainSource).toContain('canvas fallback renderer.');
        expect(validationSource).toContain(
            "requireCanvasFallback: parseBoolean(ARGS['require-canvas-fallback'], false)",
        );
        expect(validationSource).toContain(
            'if (CONFIG.requireCanvasFallback) {',
        );
        expect(validationSource).toContain(
            "gate: CONFIG.requireCanvasFallback ? 'required' : 'not-applicable'",
        );
    });
});
