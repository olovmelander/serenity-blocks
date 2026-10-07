import { gameLoop, updateGame } from '../game.js';
import { checkInfinityGameOver } from '../infinity-grid.js';
import { DEMO_FIXED_SIMULATION_CLOCK } from '../demo/DemoRecorder.js';
import { startOdysseyModeFixedTickLoop } from './odyssey-fixed-tick.js';

/** Keep one attempt's simulation and render closures together. */
export function startOdysseyGameplayLoop(mode, session, { renderStats = () => {} } = {}) {
    if (!mode._isLevelSessionActive(session)) return;
    const { gameState } = session;
    const usesFixedLoop = mode._fixedTickEnabled
        && session.simulationClock === DEMO_FIXED_SIMULATION_CLOCK;

    // Cancel any existing loop
    if (gameState.animationId !== null && gameState.animationId !== undefined) {
        cancelAnimationFrame(gameState.animationId);
        gameState.animationId = null;
    }
    mode._stopFixedTickSession();

    const { frameRateController } = mode.deps;
    if (frameRateController?.isRunning) {
        frameRateController.stopHybridLoop();
    }

    mode.lastStatsUpdateTime = performance.now();

    const drawCallback = () => {
        if (!mode._isLevelSessionActive(session)) return;
        const boardScene = mode._getBoardScene();
        if (boardScene) {
            boardScene.syncFromGameState(gameState);

            // Update camera position for tall boards
            if (
                !usesFixedLoop
                && boardScene.cameraSettings
                && !boardScene.cameraSettings.manualControl
            ) {
                mode._updateCameraPosition();
            }
        }
    };

    const statsCallback = () => {
        if (!mode._isLevelSessionActive(session)) return;
        const now = performance.now();
        if (now - mode.lastStatsUpdateTime >= mode.statsUpdateInterval) {
            mode.lastStatsUpdateTime = now;
            if (usesFixedLoop) {
                // Fixed render is presentation-only; score evaluation occurs at
                // the canonical tick boundary below.
                renderStats();
            } else {
                mode._updateStats();
            }

            // Phase 6: Update Odyssey HUD with current metrics
            mode._updateOdysseyHUD();

            // Update minimap for tall boards
            mode._updateMinimap();
        }

        if (usesFixedLoop) return;

        // Legacy simulation decisions retain their established render cadence.
        mode._checkVictoryConditions();
        if (!mode._isLevelSessionActive(session)) return;

        // Check failure conditions for tall boards (Infinity Mode logic)
        if (gameState.isInfinityMode && !gameState.isProcessingPhysics) {
            if (!gameState.isGameOver && checkInfinityGameOver(gameState)) {
                console.log('[Odyssey] Game over condition met (Board Full)');
                gameState.isGameOver = true;
                mode._handleGameOver(session);
            }
        }
    };

    const playDropCallback = () => mode.deps.soundManager?.sfxPlayer?.playDrop();
    const physicsCallbacks = mode._getPhysicsCallbacks(session);

    if (session.duel) {
        if (!frameRateController?.startHybridLoop) {
            throw new Error('Odyssey bot matches require FrameRateController');
        }
        mode.usingHybridLoop = true;
        const logicUpdate = (time, delta) => {
            if (!mode._isLevelSessionActive(session)) return;
            session.duel.update(time, delta, mode._getPhysicsCallbacks(session), playDropCallback);
            mode._checkVictoryConditions(session);
        };
        frameRateController.startHybridLoop(logicUpdate, () => {
            drawCallback();
            statsCallback();
            mode.odysseyHUD?.updateDuel(session.duel.getSnapshot());
        });
    } else if (usesFixedLoop) {
        mode.usingHybridLoop = true;
        console.log('[Odyssey] Using canonical 60 Hz simulation clock');
        gameState.lastTime = gameState.simTimeMs;
        const loop = startOdysseyModeFixedTickLoop(mode, session, {
            physicsCallbacks,
            playDropCallback,
            render: () => {
                drawCallback();
                statsCallback();
            },
        });
        mode._fixedTickLoop = loop;
        mode._fixedTickOwnership = loop.ownership;
        mode._fixedTickInputBinding = loop.inputBinding;
    } else if (frameRateController?.needsHybridMode()) {
        mode.usingHybridLoop = true;
        console.log('[Odyssey] Using hybrid loop for high FPS target');

        const logicUpdate = (time, _delta) => { // eslint-disable-line no-unused-vars -- preserve legacy callback arity
            if (!mode._isLevelSessionActive(session) || gameState.isGameOver || gameState.isPaused) return;

            updateGame(time, gameState, {
                drawCallback: null,
                updateStatsCallback: null,
                playDropCallback,
                physicsCallbacks,
            });
        };

        const renderUpdate = () => {
            drawCallback();
            statsCallback();
        };

        frameRateController.startHybridLoop(logicUpdate, renderUpdate);
    } else {
        mode.usingHybridLoop = false;
        console.log('[Odyssey] Using standard RAF loop');

        gameLoop(
            performance.now(),
            gameState,
            drawCallback,
            statsCallback,
            playDropCallback,
            physicsCallbacks,
        );
    }
}
