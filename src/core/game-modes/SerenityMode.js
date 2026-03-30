import { BaseGameMode } from './BaseGameMode.js';
import { setGlobalRenderScale } from '../../themes/base-theme.js';

import { GAME_MODES } from '../constants.js';
import { SerenityHub } from '../../ui/serenity-hub/SerenityHub.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/**
 * SerenityMode - A peaceful, non-interactive mode featuring only background visuals,
 * animations, and music. Perfect for meditation, relaxation, or just enjoying the aesthetics.
 *
 * Features:
 * - Pure theme backgrounds with WebGL particle effects
 * - Music playback with track switching
 * - Theme switching
 * - Optional breathing indicator for meditation
 * - Clean, distraction-free UI (keyboard controls only)
 * - Auto-hide cursor after inactivity
 */
export class SerenityMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Serenity mode state
        this.cleanupHandlers = [];
        this.cursorTimeout = null;
        this.keyboardOverlayTimeout = null;
        this.breathingIndicatorActive = false;

        // Interactive effects state
        this.lastInteractionTime = 0;
        this.interactionCooldown = 300; // ms between interactions
        this.comboCounter = 0;
        this.comboResetTimeout = null;
        this.comboResetDelay = 2000; // Reset combo after 2 seconds of no interaction
        this.maxComboClicks = 12; // Max clicks before cooldown
        this.comboCooldownActive = false;
        this.comboCooldownDuration = 8000; // 8 second cooldown after max combo

        // Event handlers (bound methods for proper cleanup)
        this.handleKeyPress = this._onKeyPress.bind(this);
        this.handleMouseMove = this._onMouseMove.bind(this);
        this.handleClick = this._onInteraction.bind(this);
        this.handleTouch = this._onInteraction.bind(this);
        this.handleGamepadButton = this._onGamepadButton.bind(this);

        // Serenity Hub instance
        this.serenityHub = null;
    }

    getModeId() {
        return GAME_MODES.SERENITY;
    }

    getDisplayName() {
        return 'Serenity Mode';
    }

    /**
     * Called when Serenity mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[Serenity] Activating Serenity mode...');

        // Hide ALL game UI containers
        this._hideAllGameUI();

        // Show Phaser scene for theme effects (but hide game board elements)
        this._showPhaserThemeOnly();

        // Apply full-screen canvas for theme
        this._setupFullscreenTheme();

        console.log('[Serenity] Mode activated, ready to start');
    }

    /**
     * Called when user enters Serenity mode
     */
    async onStart() {
        await super.onStart();

        console.log('[Serenity] Starting Serenity mode...');

        // Check if there's a global Serenity Hub (created by main.js)
        // If not, create mode-specific instance (fallback for testing)
        if (window.serenityBlocks && window.serenityBlocks.serenityHub) {
            console.log('[Serenity] Using global Serenity Hub instance');
            this.serenityHub = window.serenityBlocks.serenityHub;
            this.usingGlobalHub = true;
            // Update the wrapper to point to this mode for breathing controls
            this.serenityHub.serenityMode = this;
        } else {
            console.log('[Serenity] Creating mode-specific Serenity Hub instance');
            this.serenityHub = new SerenityHub(this);
            this.usingGlobalHub = false;
        }
        console.log('[Serenity] Serenity Hub initialized');

        // Ensure gamepad controller is enabled for Serenity Mode
        if (this.deps.gamepadController) {
            this.deps.gamepadController.enable();
            // Disable menu navigation mode so Serenity controls work
            this.deps.gamepadController.disableMenuNavigation();
            console.log('[Serenity] Gamepad controller enabled and menu navigation disabled');
        }

        // Ensure selected track and audible playback are synchronized.
        await this._ensureMusicPlaying();

        // Setup keyboard controls
        this._setupKeyboardControls();

        // Setup cursor auto-hide
        this._setupCursorAutoHide();

        // Setup interactive effects (click/tap to trigger effects)
        this._setupInteractiveEffects();

        // Don't auto-show keyboard shortcuts - user can press '/' to view them if needed
        // Don't auto-show breathing indicator - user must press Space to enable
        // This keeps focus on the beautiful themes
        console.log('[Serenity] Serenity mode active - Press H for Serenity Hub, Space for breathing guide');
    }

    /**
     * Called when Serenity mode is paused (settings opened)
     */
    onPause() {
        super.onPause();
        console.log('[Serenity] Paused');

        // Pause breathing indicator if it's active
        if (this.breathingIndicatorActive && window.breathingIndicator) {
            this.breathingIndicatorWasActive = true;
            window.breathingIndicator.stop();
            console.log('[Serenity] Breathing indicator paused');
        } else {
            this.breathingIndicatorWasActive = false;
        }
    }

    /**
     * Called when resumed from pause
     */
    onResume() {
        super.onResume();
        console.log('[Serenity] Resumed');

        // Disable menu navigation mode so Serenity controls work
        if (this.deps.gamepadController) {
            this.deps.gamepadController.disableMenuNavigation();
            console.log('[Serenity] Menu navigation disabled on resume');
        }

        // Resume breathing indicator if it was active before pause
        if (this.breathingIndicatorWasActive && window.breathingIndicator) {
            window.breathingIndicator.start();
            console.log('[Serenity] Breathing indicator resumed');
        }
    }

    /**
     * Called when exiting Serenity mode
     */
    async onStop() {
        await super.onStop();

        console.log('[Serenity] Stopping Serenity mode...');

        // Hide breathing indicator if shown
        this._hideBreathingIndicator();

        // Hide keyboard shortcuts overlay
        this._hideKeyboardShortcuts();

        // Show cursor again by removing hidden class
        document.body.classList.remove('cursor-hidden');
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[Serenity] Deactivating...');

        // Clean up Serenity Hub
        if (this.serenityHub) {
            if (this.usingGlobalHub) {
                // Just hide it if it's global, don't destroy
                this.serenityHub.hide();
            } else {
                this.serenityHub.destroy();
            }
            this.serenityHub = null;
        }

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);

        // Clear timeouts
        if (this.cursorTimeout) {
            clearTimeout(this.cursorTimeout);
            this.cursorTimeout = null;
        }
        if (this.keyboardOverlayTimeout) {
            clearTimeout(this.keyboardOverlayTimeout);
            this.keyboardOverlayTimeout = null;
        }
        if (this.comboResetTimeout) {
            clearTimeout(this.comboResetTimeout);
            this.comboResetTimeout = null;
        }

        // Restore UI
        this._restoreGameUI();

        // Show cursor by removing hidden class
        document.body.classList.remove('cursor-hidden');
    }

    /**
     * Handle window resize
     */
    onResize() {
        // Theme manager handles resize automatically
        // Breathing indicator will adjust via CSS
    }

    /**
     * Handle theme change
     */
    onThemeChange(theme) {
        console.log('[Serenity] Theme changed to:', theme);
    }

    /**
     * Handle settings change
     */
    onSettingsChange(settings) {
        // Check if breathing guide was toggled
        if (settings.breathingGuideEnabled && !this.breathingIndicatorActive) {
            this._showBreathingIndicator();
        } else if (!settings.breathingGuideEnabled && this.breathingIndicatorActive) {
            this._hideBreathingIndicator();
        }
    }

    /**
     * Called when Serenity Hub is opened
     * Reduces rendering quality to save GPU for UI blur
     */
    onHubOpen() {
        console.log('[Serenity] Hub opened - reducing background quality');
        this._setLowQualityMode(true);
    }

    /**
     * Called when Serenity Hub is closed
     * Restores full rendering quality
     */
    onHubClose() {
        console.log('[Serenity] Hub closed - restoring background quality');
        this._setLowQualityMode(false);
    }

    /**
     * Toggle low quality mode for background renderer
     * @private
     */
    _setLowQualityMode(enabled) {
        const { themeManager } = this.deps;
        if (!themeManager || !themeManager.webglRenderer) return;
        setGlobalRenderScale(enabled ? 0.6 : 1.0);

        const { activeTheme } = themeManager;
        if (!activeTheme) return;

        const { renderer } = activeTheme;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const rawRatio = typeof activeTheme.getEffectivePixelRatio === 'function'
            ? activeTheme.getEffectivePixelRatio()
            : Math.min(window.devicePixelRatio || 1, 2);
        const effectiveRatio = Number.isFinite(rawRatio) && rawRatio > 0
            ? rawRatio
            : Math.min(window.devicePixelRatio || 1, 2);

        // Re-apply pixel ratio and size immediately so quality mode takes effect now.
        if (renderer?.setPixelRatio) {
            renderer.setPixelRatio(effectiveRatio);
            if (renderer.setSize) {
                renderer.setSize(width, height, false);
            }
        }

        if (activeTheme.composer?.setPixelRatio) {
            activeTheme.composer.setPixelRatio(effectiveRatio);
        }
        if (activeTheme.composer?.setSize) {
            activeTheme.composer.setSize(width, height);
        }

        if (activeTheme.postComposer?.setPixelRatio) {
            activeTheme.postComposer.setPixelRatio(effectiveRatio);
        }
        if (activeTheme.postComposer?.setSize) {
            activeTheme.postComposer.setSize(width, height);
        }
    }

    // ===== Private Methods =====

    /**
     * Hide all game UI elements for clean experience
     * @private
     */
    _hideAllGameUI() {
        // Hide single player container
        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'none';
        }

        // Hide single player stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.display = 'none';
        }

        // Hide multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        // Hide stats panel
        const statsPanel = document.getElementById('stats-panel');
        if (statsPanel) {
            statsPanel.style.display = 'none';
        }

        // Hide next pieces
        const nextPiecesContainer = document.getElementById('next-pieces');
        if (nextPiecesContainer) {
            nextPiecesContainer.style.display = 'none';
        }

        // Hide any game controls
        const gameControls = document.getElementById('game-controls');
        if (gameControls) {
            gameControls.style.display = 'none';
        }

        // Add serenity mode class to body for special styling
        document.body.classList.add('serenity-mode');
    }

    /**
     * Restore game UI elements when exiting
     * @private
     */
    _restoreGameUI() {
        // Remove serenity mode class
        document.body.classList.remove('serenity-mode');

        // UI will be restored by the next mode that activates
    }

    /**
     * Show Phaser scene for theme effects only (no game board)
     * @private
     */
    _showPhaserThemeOnly() {
        const { phaserGame } = this.deps;
        if (!phaserGame?.scene) return;

        // Get BoardScene (which handles theme rendering)
        const boardScene = phaserGame.scene.getScene('BoardScene');
        if (boardScene) {
            // Resume the scene for theme effects
            boardScene.scene.setVisible(true);
            boardScene.scene.resume();

            // Hide game board elements if they exist
            if (boardScene.hideGameElements) {
                boardScene.hideGameElements();
            }
        }

        // Hide any multiplayer scenes
        ['BoardPanel1', 'BoardPanel2'].forEach((key) => {
            const scene = phaserGame.scene.getScene(key);
            if (scene) {
                scene.scene.setVisible(false);
                scene.scene.stop();
            }
        });
    }

    /**
     * Setup fullscreen theme canvas
     * @private
     */
    _setupFullscreenTheme() {
        const phaserCanvas = this.deps.phaserGame?.canvas;
        if (!phaserCanvas) return;

        // Store original size for restore
        if (!phaserCanvas.dataset.originalWidth) {
            phaserCanvas.dataset.originalWidth = phaserCanvas.width;
            phaserCanvas.dataset.originalHeight = phaserCanvas.height;
        }

        // Set canvas to fullscreen
        const width = window.innerWidth;
        const height = window.innerHeight;

        if (this.deps.phaserGame?.resize) {
            this.deps.phaserGame.resize(width, height);
        }

        // Position absolutely to cover viewport
        phaserCanvas.style.position = 'fixed';
        phaserCanvas.style.top = '0';
        phaserCanvas.style.left = '0';
        phaserCanvas.style.width = '100vw';
        phaserCanvas.style.height = '100vh';
        phaserCanvas.style.zIndex = '1';
    }

    /**
     * Ensure music is playing
     * @private
     */
    async _ensureMusicPlaying() {
        const { soundManager } = this.deps;
        if (soundManager) {
            // Resume audio context if suspended (browser autoplay policy)
            soundManager.resumeAudioContext();

            if (typeof soundManager.ensureTrackPlaybackSynced === 'function') {
                await soundManager.ensureTrackPlaybackSynced({
                    reason: 'serenity-enter',
                    force: true,
                });
                return;
            }

            // Backward-compatible fallback for older sound manager implementations.
            const isPlaying = soundManager.audioElement && !soundManager.audioElement.paused;
            if (!isPlaying) {
                const settings = this.deps.settingsManager.get();
                const trackName = settings.musicTrack || 'Ambient';
                soundManager.setTrack(trackName);
            }
        }
    }

    /**
     * Setup keyboard controls
     * @private
     */
    _setupKeyboardControls() {
        document.addEventListener('keydown', this.handleKeyPress);
        this.cleanupHandlers.push(() => {
            document.removeEventListener('keydown', this.handleKeyPress);
        });
    }

    /**
     * Handle key press
     * @private
     */
    _onKeyPress(event) {
        if (!this.isRunning) return;

        // Don't handle keys if settings modal is open
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('visible')) {
            return;
        }

        const { key } = event;

        // Handle hardcoded Serenity-specific keys
        switch (key.toLowerCase()) {
            case 'escape': // Exit to main menu
                this._exitToMenu();
                break;

            case 'h': // Toggle Serenity Hub - Keep this hardcoded for now as it's specific to this mode
                if (this.serenityHub) {
                    this.serenityHub.toggle();
                }
                event.preventDefault(); // Prevent global high score handler
                event.stopPropagation(); // Stop event from bubbling
                break;

            case '?': // Show keyboard shortcuts (legacy)
            case '/': // Toggle control hints
                if (this.serenityHub) {
                    this.serenityHub.toggleButtonHints();
                } else {
                    this._showKeyboardShortcuts();
                }
                break;

            case ' ': // Toggle breathing indicator
                this._toggleBreathingIndicator();
                event.preventDefault(); // Prevent page scroll
                break;

            case 't': // Cycle breathing technique
                this._cycleBreathingTechnique();
                event.preventDefault();
                break;

            case 'b': // Random theme
                this._randomTheme();
                break;

            case 'f': // Toggle fullscreen
                this._toggleFullscreen();
                break;
        }
    }

    /**
     * Setup cursor auto-hide
     * @private
     */
    _setupCursorAutoHide() {
        document.addEventListener('mousemove', this.handleMouseMove);
        this.cleanupHandlers.push(() => {
            document.removeEventListener('mousemove', this.handleMouseMove);
        });

        // Initial hide after 3 seconds
        this._scheduleCursorHide();
    }

    /**
     * Handle mouse move
     * @private
     */
    _onMouseMove() {
        // Show cursor by removing the hidden class
        document.body.classList.remove('cursor-hidden');

        // Reset hide timer
        this._scheduleCursorHide();
    }

    /**
     * Schedule cursor hide
     * @private
     */
    _scheduleCursorHide() {
        if (this.cursorTimeout) {
            clearTimeout(this.cursorTimeout);
        }

        this.cursorTimeout = setTimeout(() => {
            // Hide cursor by adding the hidden class
            document.body.classList.add('cursor-hidden');
        }, 3000);
    }

    /**
     * Random theme
     * @private
     */
    _randomTheme() {
        const { themeManager } = this.deps;
        if (themeManager && themeManager.switchToRandomTheme) {
            themeManager.switchToRandomTheme();
            this._showNotification('Theme Changed');
        }
    }

    /**
     * Toggle fullscreen
     * @private
     */
    _toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            this._showNotification('Fullscreen On');
        } else {
            document.exitFullscreen();
            this._showNotification('Fullscreen Off');
        }
    }

    /**
     * Exit to main menu
     * @private
     */
    async _exitToMenu() {
        await this.onStop();
        await this.onDeactivate();

        // Dispatch event to return to menu
        window.dispatchEvent(new CustomEvent('returnToMenu'));
    }

    /**
     * Show keyboard shortcuts overlay
     * @private
     */
    _showKeyboardShortcuts() {
        let overlay = document.getElementById('serenity-shortcuts-overlay');

        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'serenity-shortcuts-overlay';
            overlay.className = 'serenity-shortcuts-overlay';
            overlay.innerHTML = `
                <div class="shortcuts-content">
                    <h3>Serenity Mode Controls</h3>
                    <div class="shortcut"><kbd>Click/Tap</kbd> Trigger Theme Effects</div>
                    <div class="shortcut"><kbd>H</kbd> Open Serenity Hub</div>
                    <div class="shortcut"><kbd>B</kbd> Random Theme</div>
                    <div class="shortcut"><kbd>Space</kbd> Toggle Breathing Guide</div>
                    <div class="shortcut"><kbd>I</kbd> Show Technique Info</div>
                    <div class="shortcut"><kbd>T</kbd> Cycle Breathing Technique</div>
                    <div class="shortcut"><kbd>F</kbd> Toggle Fullscreen</div>
                    <div class="shortcut"><kbd>ESC</kbd> Exit to Menu</div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        overlay.classList.add('visible');

        // Auto-hide after 5 seconds
        if (this.keyboardOverlayTimeout) {
            clearTimeout(this.keyboardOverlayTimeout);
        }

        this.keyboardOverlayTimeout = setTimeout(() => {
            overlay.classList.remove('visible');
        }, 5000);
    }

    /**
     * Hide keyboard shortcuts overlay
     * @private
     */
    _hideKeyboardShortcuts() {
        const overlay = document.getElementById('serenity-shortcuts-overlay');
        if (overlay) {
            overlay.classList.remove('visible');
        }
    }

    /**
     * Toggle breathing indicator
     * @private
     */
    _toggleBreathingIndicator() {
        // Toggle based on actual state, not settings
        if (this.breathingIndicatorActive) {
            this._hideBreathingIndicator();
            this._showNotification('Breathing Guide Off');
            // Update settings
            this.deps.settingsManager.update({ breathingGuideEnabled: false });
        } else {
            this._showBreathingIndicator();
            this._showNotification('Breathing Guide On');
            // Update settings
            this.deps.settingsManager.update({ breathingGuideEnabled: true });
        }
    }

    /**
     * Show breathing indicator
     * @private
     */
    _showBreathingIndicator() {
        // Use the global enhanced breathing indicator instance
        if (window.breathingIndicator) {
            const settings = this.deps.settingsManager.get();

            // Apply settings before starting
            const technique = settings.breathingTechnique || 'deep-relaxation';
            window.breathingIndicator.setTechnique(technique);
            window.breathingIndicator.setShowText(settings.breathingText !== false);

            // Start the animation
            window.breathingIndicator.start();
            this.breathingIndicatorActive = true;

            // Update Serenity Hub icon state
            if (this.serenityHub) {
                this.serenityHub.updateIconState({ breathingActive: true });
            }

            console.log('[Serenity] Enhanced breathing indicator started with technique:', technique);
        } else {
            console.warn('[Serenity] Breathing indicator not initialized');
        }
    }

    /**
     * Hide breathing indicator
     * @private
     */
    _hideBreathingIndicator() {
        if (window.breathingIndicator) {
            window.breathingIndicator.stop();
            this.breathingIndicatorActive = false;

            // Update Serenity Hub icon state
            if (this.serenityHub) {
                this.serenityHub.updateIconState({ breathingActive: false });
            }

            console.log('[Serenity] Breathing indicator stopped');
        }
    }

    /**
     * Cycle through breathing techniques
     * @private
     */
    _cycleBreathingTechnique() {
        if (!window.breathingIndicator || !this.breathingIndicatorActive) {
            this._showNotification('Enable breathing guide first (Space)');
            return;
        }

        // Get techniques dynamically from the breathing indicator
        const techniques = Object.keys(window.breathingIndicator.techniques);
        const currentTechnique = window.breathingIndicator.currentTechnique || 'deep-relaxation';
        const currentIndex = techniques.indexOf(currentTechnique);
        const nextIndex = (currentIndex + 1) % techniques.length;
        const nextTechnique = techniques[nextIndex];

        // Update settings
        this.deps.settingsManager.update({ breathingTechnique: nextTechnique });

        // Apply to breathing indicator
        // The breathing indicator itself will show the technique name, no need for separate notification
        window.breathingIndicator.setTechnique(nextTechnique);
    }

    /**
     * Show temporary notification
     * @private
     */
    _showNotification(message) {
        let notification = document.getElementById('serenity-notification');

        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'serenity-notification';
            notification.className = 'serenity-notification';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.classList.add('visible');

        setTimeout(() => {
            notification.classList.remove('visible');
        }, 2000);
    }

    // ===== Interactive Effects Methods =====

    /**
     * Setup interactive effects (mouse, touch, gamepad)
     * @private
     */
    _setupInteractiveEffects() {
        // Mouse click listener
        document.addEventListener('click', this.handleClick);
        this.cleanupHandlers.push(() => {
            document.removeEventListener('click', this.handleClick);
        });

        // Touch listener
        document.addEventListener('touchstart', this.handleTouch, { passive: true });
        this.cleanupHandlers.push(() => {
            document.removeEventListener('touchstart', this.handleTouch);
        });

        // Gamepad button polling (if gamepad is connected)
        if (this.deps.gamepadController) {
            this.gamepadPollInterval = setInterval(this.handleGamepadButton, 100);
            this.cleanupHandlers.push(() => {
                if (this.gamepadPollInterval) {
                    clearInterval(this.gamepadPollInterval);
                    this.gamepadPollInterval = null;
                }
            });
        }

        console.log('[Serenity] Interactive effects enabled - Click, tap, or press gamepad buttons to trigger theme effects');
    }

    /**
     * Handle interaction (click or touch)
     * @private
     */
    _onInteraction(event) {
        if (!this.isRunning) return;

        // Don't trigger if clicking on UI elements
        const { target } = event;
        if (target && (
            target.closest('.serenity-hub')
            || target.closest('.serenity-notification')
            || target.closest('.serenity-shortcuts-overlay')
            || target.closest('#settings-modal')
            || target.closest('.breathing-indicator')
        )) {
            return;
        }

        // Check if combo cooldown is active
        if (this.comboCooldownActive) {
            // Show red ripple to indicate cooldown
            if (event) {
                let clickX = window.innerWidth / 2;
                let clickY = window.innerHeight / 2;
                if (event.type === 'click') {
                    clickX = event.clientX;
                    clickY = event.clientY;
                } else if (event.type === 'touchstart' && event.touches.length > 0) {
                    clickX = event.touches[0].clientX;
                    clickY = event.touches[0].clientY;
                }
                this._showClickRipple(clickX, clickY, true); // true = cooldown mode
            }
            return;
        }

        // Cooldown check to prevent spam
        const now = Date.now();
        if (now - this.lastInteractionTime < this.interactionCooldown) {
            return;
        }
        this.lastInteractionTime = now;

        // Trigger effects
        this._triggerInteractionEffect(event);
    }

    /**
     * Handle gamepad button press
     * @private
     */
    _onGamepadButton() {
        if (!this.isRunning) return;
        if (!this.deps.gamepadController) return;

        const gamepad = this.deps.gamepadController.getGamepad();
        if (!gamepad) return;

        // Check if any button is pressed (except D-pad and special buttons)
        // A button (index 0), B button (index 1), X button (index 2), Y button (index 3)
        // Shoulder buttons L1/R1 (index 4, 5), L2/R2 (index 6, 7)
        const actionButtons = [0, 1, 2, 3, 4, 5, 6, 7];

        for (const buttonIndex of actionButtons) {
            const button = gamepad.buttons[buttonIndex];
            if (button && button.pressed) {
                // Check if this is a new press (not held down)
                const buttonKey = `gamepad_button_${buttonIndex}`;
                if (!this[buttonKey]) {
                    this[buttonKey] = true;
                    this._triggerInteractionEffect(null, buttonIndex);
                }
            } else {
                const buttonKey = `gamepad_button_${buttonIndex}`;
                this[buttonKey] = false;
            }
        }
    }

    /**
     * Trigger interaction effect
     * @private
     */
    _triggerInteractionEffect(event, gamepadButton = null) {
        // Increment combo counter
        this.comboCounter++;

        // Check if max combo reached
        if (this.comboCounter >= this.maxComboClicks) {
            this._activateMaxComboCooldown();
        }

        // Reset combo timeout
        if (this.comboResetTimeout) {
            clearTimeout(this.comboResetTimeout);
        }
        this.comboResetTimeout = setTimeout(() => {
            this.comboCounter = 0;
        }, this.comboResetDelay);

        // Determine effect intensity based on combo
        // 1-2 clicks: single line clear
        // 3-4 clicks: double line clear
        // 5-6 clicks: triple line clear
        // 7+ clicks: quad line clear
        const lineCount = Math.min(Math.floor((this.comboCounter + 1) / 2), 4);
        const comboCount = Math.max(0, this.comboCounter - 1);

        // Get click position for visual feedback
        let clickX = window.innerWidth / 2;
        let clickY = window.innerHeight / 2;

        if (event) {
            if (event.type === 'click') {
                clickX = event.clientX;
                clickY = event.clientY;
            } else if (event.type === 'touchstart' && event.touches.length > 0) {
                clickX = event.touches[0].clientX;
                clickY = event.touches[0].clientY;
            }
        }

        // Show visual feedback at click location
        this._showClickRipple(clickX, clickY);

        // Emit LINE_CLEAR event
        eventBus.emit(EVENTS.LINE_CLEAR, {
            lineCount,
            comboCount,
            source: 'serenity-interaction',
            position: { x: clickX, y: clickY },
        });

        // If combo >= 2, also emit COMBO event
        if (comboCount >= 2) {
            eventBus.emit(EVENTS.COMBO, {
                comboCount,
                source: 'serenity-interaction',
                position: { x: clickX, y: clickY },
            });
        }

        // Log interaction
        const source = gamepadButton !== null ? `Gamepad Button ${gamepadButton}` : 'Click/Tap';
        console.log(`[Serenity] Interaction: ${source}, Lines: ${lineCount}, Combo: ${comboCount}`);

        // Show combo notification for significant combos
        if (comboCount >= 3 && comboCount % 3 === 0) {
            this._showNotification(`${comboCount}x Combo!`);
        }
    }

    /**
     * Activate max combo cooldown
     * @private
     */
    _activateMaxComboCooldown() {
        this.comboCooldownActive = true;
        this.comboCounter = 0;

        // Clear any existing combo reset timeout
        if (this.comboResetTimeout) {
            clearTimeout(this.comboResetTimeout);
            this.comboResetTimeout = null;
        }

        // Show notification
        this._showNotification('Max Combo! Cooling down...');
        console.log(`[Serenity] Max combo (${this.maxComboClicks}) reached - ${this.comboCooldownDuration}ms cooldown activated`);

        // Deactivate after cooldown period
        setTimeout(() => {
            this.comboCooldownActive = false;
            this._showNotification('Ready!');
            console.log('[Serenity] Combo cooldown complete - interactions enabled');
        }, this.comboCooldownDuration);
    }

    /**
     * Show click ripple effect
     * @private
     */
    _showClickRipple(x, y, isCooldown = false) {
        const ripple = document.createElement('div');
        ripple.className = isCooldown ? 'serenity-click-ripple cooldown' : 'serenity-click-ripple';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        document.body.appendChild(ripple);

        // Remove after animation completes
        setTimeout(() => {
            ripple.remove();
        }, 1000);
    }
}
