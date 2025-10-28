import { BaseGameMode } from './BaseGameMode.js';
import { GAME_MODES } from '../constants.js';

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

        // Event handlers (bound methods for proper cleanup)
        this.handleKeyPress = this._onKeyPress.bind(this);
        this.handleMouseMove = this._onMouseMove.bind(this);
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

        // Start music if not already playing
        this._ensureMusicPlaying();

        // Setup keyboard controls
        this._setupKeyboardControls();

        // Setup cursor auto-hide
        this._setupCursorAutoHide();

        // Show keyboard shortcuts overlay briefly
        this._showKeyboardShortcuts();

        // Don't auto-show breathing indicator - user must press Space to enable
        // This keeps focus on the beautiful themes
        console.log('[Serenity] Serenity mode active - Press Space for breathing guide');
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
        const phaserGame = this.deps.phaserGame;
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
    _ensureMusicPlaying() {
        const soundManager = this.deps.soundManager;
        if (soundManager) {
            // Resume audio context if suspended (browser autoplay policy)
            soundManager.resumeAudioContext();

            // Check if audio element exists and is playing
            const isPlaying = soundManager.audioElement && !soundManager.audioElement.paused;

            // Start music if not playing
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

        const key = event.key.toLowerCase();

        switch (key) {
            case 'm': // Next music track
                this._nextMusicTrack();
                break;

            case 'b': // Random theme
                this._randomTheme();
                break;

            case 'f': // Toggle fullscreen
                this._toggleFullscreen();
                break;

            case 'escape': // Exit to main menu
                this._exitToMenu();
                break;

            case 'h': // Toggle settings
                // Settings modal is handled globally
                break;

            case '?': // Show keyboard shortcuts
                this._showKeyboardShortcuts();
                break;

            case ' ': // Toggle breathing indicator
                this._toggleBreathingIndicator();
                event.preventDefault(); // Prevent page scroll
                break;

            case 't': // Cycle breathing technique
                this._cycleBreathingTechnique();
                event.preventDefault();
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
     * Next music track
     * @private
     */
    _nextMusicTrack() {
        const soundManager = this.deps.soundManager;
        if (soundManager && soundManager.nextTrack) {
            soundManager.nextTrack();
            this._showNotification('Next Track');
        }
    }

    /**
     * Random theme
     * @private
     */
    _randomTheme() {
        const themeManager = this.deps.themeManager;
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
                    <div class="shortcut"><kbd>M</kbd> Next Music Track</div>
                    <div class="shortcut"><kbd>B</kbd> Random Theme</div>
                    <div class="shortcut"><kbd>Space</kbd> Toggle Breathing Guide</div>
                    <div class="shortcut"><kbd>I</kbd> Show Technique Info</div>
                    <div class="shortcut"><kbd>S</kbd> Show/Hide Technique Selector</div>
                    <div class="shortcut"><kbd>T</kbd> Cycle Breathing Technique</div>
                    <div class="shortcut"><kbd>F</kbd> Toggle Fullscreen</div>
                    <div class="shortcut"><kbd>H</kbd> Settings</div>
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

        const techniques = ['deep-relaxation', 'box-breathing', 'calm-sleep', 'energizing', 'coherence', 'triangle', 'wim-hof'];
        const settings = this.deps.settingsManager.get();
        const currentTechnique = settings.breathingTechnique || 'deep-relaxation';
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
}
