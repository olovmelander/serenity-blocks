import { BaseGameMode } from './BaseGameMode.js';
import { setGlobalRenderScale } from '../../themes/base-theme.js';

import { DEFAULT_SETTINGS, GAME_MODES } from '../constants.js';
import { SerenityHub } from '../../ui/serenity-hub/SerenityHub.js';
import { SerenityModeUi } from '../../ui/serenity-mode/serenity-mode-ui.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

/** Keys whose auto-repeat is wanted (holding ↑ keeps turning the music up); the rest act once. */
const REPEATING_ACTIONS = new Set(['volumeUp', 'volumeDown']);
/** While the Hub is open it owns the keyboard; only these Serenity keys still reach the mode. */
const HUB_OPEN_ACTIONS = new Set(['toggleHub', 'toggleFullscreen', 'toggleControlHints']);

/**
 * SerenityMode - the theme, its music and your breath, with nothing to play: a place to watch,
 * drift between worlds and rest.
 *
 * Features:
 * - The theme full screen; its world bar (top centre) names the theme and the song and steps
 *   between themes (← → on a keyboard, the D-pad, a swipe, the bar's arrows)
 * - Drift: the world follows the music, or moves on every 10 to 30 minutes, by itself
 * - Rest: a timer after which the music fades and the screen dims and sleeps
 * - Music from the keyboard (↑ ↓ volume, , . songs, M mute) and the media keys
 * - The breathing guide, in a world of its own or over the theme (the camera breathes with you)
 * - Touch the world (a press, a tap, A on a pad) for a soft reaction; swipe to change theme
 * - Effects (E, the bar's chip): every reaction a theme has to play — a lock, a hard drop, line
 *   clears, combos, cascades, a T-spin, back-to-back, a perfect clear, a level up — on demand
 * - The cursor and the world bar leave when you are still; the screen stays awake
 *
 * The on-screen parts live in src/ui/serenity-mode/ (SerenityModeUi); this class owns the
 * lifecycle and the key map. Record: docs/SERENITY_MODE_DRIFT_2026-10.md.
 */
export class SerenityMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Serenity mode state
        this.cleanupHandlers = [];
        this.cursorTimeout = null;
        this.breathingIndicatorActive = false;
        /** @type {SerenityModeUi|null} the world bar, drift, rest, touch, notices (src/ui/serenity-mode) */
        this.ui = null;

        // Event handlers (bound methods for proper cleanup)
        this.handleKeyPress = this._onKeyPress.bind(this);
        this.handleMouseMove = this._onMouseMove.bind(this);

        // Serenity Hub instance
        this.serenityHub = null;

        /** Bumped by every start, stop and deactivate: a start the player has left owns nothing. */
        this._startGeneration = 0;
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
        // A start the player leaves before it finishes (Settings → Main menu while the music syncs)
        // must not go on to take the wake lock, the media keys, the drift or the pad on the menu.
        this._startGeneration += 1;
        const startGeneration = this._startGeneration;
        const ownsStart = () => startGeneration === this._startGeneration && this.isActive && this.isRunning;
        await super.onStart();
        if (!ownsStart()) return;

        console.log('[Serenity] Starting Serenity mode...');

        // Check if there's a global Serenity Hub (created by main.js)
        // If not, create mode-specific instance (fallback for testing)
        if (window.serenityBlocks) {
            if (!window.serenityBlocks.serenityHub) {
                console.log('[Serenity] Global Serenity Hub not initialized yet. Initializing immediately...');
                await window.serenityBlocks.initializeGlobalSerenityHub();
                if (!ownsStart()) return;
            }
            console.log('[Serenity] Using global Serenity Hub instance');
            this.serenityHub = window.serenityBlocks.serenityHub;
            this.usingGlobalHub = true;
            if (this.serenityHub) {
                // Update the wrapper to point to this mode for breathing controls
                this.serenityHub.setMode(this);
            }
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
        if (!ownsStart()) return;

        // Setup keyboard controls
        this._setupKeyboardControls();

        // Setup cursor auto-hide
        this._setupCursorAutoHide();

        // The world bar, drift, rest, touch, the wake lock and the media keys.
        this._setupSerenityUi();
        // Settings opened while it started: hold the drift as onPause would have (it had no ui yet).
        if (this.isPaused) this.ui?.drift?.hold('settings');

        // Breathing over the theme belongs to this mode alone.
        const guide = this._guide();
        guide?.setVeilAllowed?.(true);
        guide?.setOverTheme?.(this.deps.settingsManager.get().breathingOverTheme === true);

        // The breathing guide waits for Space unless the player asked for it to begin here.
        if (this.deps.settingsManager.get().breathingGuideAutoStart) this._showBreathingIndicator();
        const serenityKeys = this._getSerenityKeyBindings();
        console.log(
            '[Serenity] Serenity mode active - Hub:',
            serenityKeys.toggleHub,
            'Breathing:',
            serenityKeys.toggleBreathing,
        );
    }

    /**
     * Called when Serenity mode is paused (settings opened)
     */
    onPause() {
        super.onPause();
        console.log('[Serenity] Paused');
        this.ui?.drift?.hold('settings');

        // Settings pause the standalone guide. A journey keeps its own timers
        // and rhythm, so stopping/restarting its visual would desynchronize it.
        const indicator = this._guide();
        if (this.breathingIndicatorActive && indicator && !indicator.isExternallyControlled) {
            this.breathingIndicatorWasActive = true;
            indicator.stop();
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
        this.ui?.drift?.release('settings');

        // Disable menu navigation mode so Serenity controls work
        if (this.deps.gamepadController) {
            this.deps.gamepadController.disableMenuNavigation();
            console.log('[Serenity] Menu navigation disabled on resume');
        }

        // Resume breathing indicator if it was active before pause
        const indicator = this._guide();
        if (this.breathingIndicatorWasActive && indicator && !indicator.isExternallyControlled) {
            indicator.start();
            console.log('[Serenity] Breathing indicator resumed');
        }
    }

    /**
     * Called when exiting Serenity mode
     */
    async onStop() {
        this._startGeneration += 1;
        await super.onStop();

        console.log('[Serenity] Stopping Serenity mode...');

        // The global Hub survives mode changes, so end its journey and pending
        // preparation here before a delayed countdown or completion can reopen it.
        const sessionsTab = this.serenityHub?.sessionsTab;
        if (sessionsTab) sessionsTab.cancelForModeChange();
        else this.serenityHub?.sessionManager?.stopSession();

        // Hide breathing indicator if shown
        this._hideBreathingIndicator();
        this._guide()?.setVeilAllowed?.(false);

        this.ui?.stop();
        this.ui = null;

        // Show cursor again by removing hidden class
        document.body.classList.remove('cursor-hidden');
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        this._startGeneration += 1;
        await super.onDeactivate();

        console.log('[Serenity] Deactivating...');

        // Clean up Serenity Hub
        if (this.serenityHub) {
            if (this.usingGlobalHub) {
                // Just hide it if it's global, don't destroy
                this.serenityHub.hide();
                // Restore original mode wrapper for non-Serenity Mode usage
                if (typeof this.serenityHub.resetModeToOriginal === 'function') {
                    this.serenityHub.resetModeToOriginal();
                }
            } else {
                this.serenityHub.destroy();
            }
            this.serenityHub = null;
        }

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);
        this.ui?.stop();
        this.ui = null;

        // Clear timeouts
        if (this.cursorTimeout) {
            clearTimeout(this.cursorTimeout);
            this.cursorTimeout = null;
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
        const indicator = this._guide();
        indicator?.setOverTheme?.(settings.breathingOverTheme === true);
        // A guided journey owns the indicator's rhythm until the session ends.
        if (indicator?.isExternallyControlled) return;
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
                const trackName = settings.musicTrack || DEFAULT_SETTINGS.musicTrack;
                soundManager.setTrack(trackName);
            }
        }
    }

    /**
     * The world bar, drift, rest, touch, notices, the wake lock and the media keys
     * (src/ui/serenity-mode/serenity-mode-ui.js).
     * @private
     */
    _setupSerenityUi() {
        this.ui?.stop();
        this.ui = new SerenityModeUi(this);
        this.ui.start();
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
    _getSerenityKeyBindings() {
        const savedBindings = this.deps.settingsManager?.get?.()?.serenityKeyBindings || {};
        return {
            ...DEFAULT_SETTINGS.serenityKeyBindings,
            ...savedBindings,
        };
    }

    /** The key bound to a Serenity action (the player's own, else the default). */
    keyFor(action) {
        return this._getSerenityKeyBindings()[action] || '';
    }

    _normalizeSerenityKey(key) {
        if (key === ' ') return 'Space';
        if (key === 'Esc') return 'Escape';
        return key && key.length === 1 ? key.toLowerCase() : key;
    }

    _matchesSerenityKey(inputKey, bindingKey) {
        const normalizedInput = this._normalizeSerenityKey(inputKey);
        const normalizedBinding = this._normalizeSerenityKey(bindingKey);

        if (normalizedInput === normalizedBinding) {
            return true;
        }

        return (normalizedBinding === '/' && normalizedInput === '?')
            || (normalizedBinding === '?' && normalizedInput === '/');
    }

    _getSerenityActionForKey(event) {
        const bindings = this._getSerenityKeyBindings();
        return Object.keys(bindings).find((action) => this._matchesSerenityKey(event.key, bindings[action]));
    }

    _onKeyPress(event) {
        if (!this.isRunning) return;
        // Shortcuts are bare keys: Ctrl+F or Alt+H belong to the browser and the system.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;

        // Don't handle keys if settings modal is open
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal && settingsModal.classList.contains('visible')) {
            return;
        }

        // Resting, any key only brings the world back.
        if (this.ui?.resting) {
            this.ui.wakeFromRest();
            event.preventDefault?.();
            return;
        }

        const action = this._getSerenityActionForKey(event);
        if (!action) return;
        // Held keys repeat only where repeating means something (the volume).
        if (event.repeat && !REPEATING_ACTIONS.has(action)) return;
        // The open Hub owns its keys (arrows walk its tabs and cards), and so do a Hale
        // session's full-screen preparation, countdown and result.
        const ownsKeys = this.serenityHub?.isOpen === true || this.serenityHub?.sessionsTab?.flowOpen === true;
        if (ownsKeys && !HUB_OPEN_ACTIONS.has(action)) return;

        switch (action) {
        case 'exitToMenu':
            this._exitToMenu();
            break;

        case 'toggleHub':
            if (this.serenityHub) {
                this.serenityHub.toggle();
            }
            event.preventDefault?.();
            event.stopPropagation?.();
            break;

        case 'toggleControlHints':
            this.serenityHub?.toggleButtonHints();
            break;

        case 'toggleBreathing':
            this._toggleBreathingIndicator();
            event.preventDefault?.();
            break;

        case 'cycleBreathingTechnique':
            this._cycleBreathingTechnique();
            event.preventDefault?.();
            break;

        case 'randomTheme':
            this.ui?.randomWorld();
            break;

        case 'toggleFullscreen':
            this._toggleFullscreen();
            break;

        case 'previousTheme':
        case 'nextTheme':
            this.stepWorld(action === 'previousTheme' ? -1 : 1);
            event.preventDefault?.();
            break;

        case 'volumeUp':
        case 'volumeDown':
            this.ui?.nudgeVolume(action === 'volumeUp' ? 1 : -1);
            event.preventDefault?.();
            break;

        case 'previousTrack':
        case 'nextTrack':
            this.ui?.stepSong(action === 'previousTrack' ? -1 : 1);
            break;

        case 'toggleMute':
            this.ui?.toggleMute();
            break;

        case 'toggleDrift':
            this.ui?.toggleDrift();
            break;

        case 'toggleEffects':
            this.ui?.toggleEffects({ fromKey: true });
            event.preventDefault?.();
            break;

        default:
            break;
        }
    }

    /**
     * Previous (-1) or next (1): the theme, or while a practice is open its breathing world
     * (the arrows always change the world in front of you). A Hale session keeps its own.
     */
    stepWorld(direction) {
        const guide = this._guide();
        if (guide?.isActive) {
            if (!guide.isExternallyControlled) guide.cycleTechnique(direction < 0 ? -1 : 1);
            return;
        }
        this.ui?.stepWorld(direction);
    }

    /**
     * Play one of the theme effects on the theme on screen (the effects tray's buttons; also
     * reachable from the console for captures). Ids: src/ui/serenity-mode/serenity-effects.js.
     * @param {string} id
     * @returns {boolean} whether it played
     */
    playEffect(id) {
        return this.ui?.playEffect(id) === true;
    }

    /** A controller's A with nothing else to do: touch the world. */
    touchWorld() {
        this.ui?.touchWorld();
    }

    /** Music volume from a controller's triggers: smaller steps, they repeat while held. */
    nudgeMusicVolume(direction, step = 0.02) {
        this.ui?.nudgeVolume(direction, step);
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
        this.ui?.activity();

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
     * Random theme. The world bar names it when it arrives (SerenityModeUi listens for
     * THEME_CHANGED); this resolves true only when the requested theme really started.
     * @private
     */
    async _randomTheme() {
        const { themeManager } = this.deps;
        this._themeRandomRequestToken = (this._themeRandomRequestToken || 0) + 1;
        const request = this._themeRandomRequestToken;
        if (!this.isActive || !themeManager?.getRandomTheme || !themeManager?.switchTheme) return false;
        const previousTheme = themeManager.activeThemeName;
        const requestedTheme = themeManager.getRandomTheme();
        if (!requestedTheme || requestedTheme === previousTheme
            || themeManager.canSelectTheme?.(requestedTheme) === false) return false;
        try {
            const appliedTheme = await themeManager.switchTheme(requestedTheme);
            return this.isActive && request === this._themeRandomRequestToken
                && appliedTheme === requestedTheme && appliedTheme === themeManager.activeThemeName;
        } catch (error) {
            console.warn('[Serenity] Random theme switch failed:', error);
            return false;
        }
    }

    /**
     * Toggle fullscreen
     * @private
     */
    _toggleFullscreen() {
        this.ui?.toggleFullscreen();
    }

    /**
     * Exit to main menu
     * @private
     */
    async _exitToMenu() {
        // The app's return path stops and deactivates this mode through GameModeManager,
        // then shows the menu; a window 'returnToMenu' event shows no menu (audit LIFE-03).
        eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
    }

    /** The breathing guide (one shared instance: src/ui/effects/breathing/breathing-guide.js). */
    _guide() {
        return window.breathingIndicator || null;
    }

    /**
     * Toggle breathing indicator
     * @private
     */
    _toggleBreathingIndicator() {
        const indicator = this._guide();
        if (indicator?.isExternallyControlled) {
            this.serenityHub?.switchTab('sessions');
            this.serenityHub?.show();
            return;
        }
        // Toggle based on actual state, not settings
        if (indicator?.isActive) {
            this._hideBreathingIndicator();
            this._showNotification('Breathing guide off');
            // Update settings
            this.deps.settingsManager.update({ breathingGuideEnabled: false });
        } else {
            this._showBreathingIndicator();
            // Update settings
            this.deps.settingsManager.update({ breathingGuideEnabled: true });
        }
    }

    /**
     * Show breathing indicator
     * @private
     */
    _showBreathingIndicator() {
        const indicator = this._guide();
        if (indicator?.isExternallyControlled) return;
        // Use the global enhanced breathing indicator instance
        if (indicator) {
            const settings = this.deps.settingsManager.get();

            // Apply settings before starting: the world you chose, if you have found it.
            const technique = indicator.allowedWorld?.(settings.breathingTechnique) || settings.breathingTechnique || 'coherence';
            indicator.setTechnique(technique);
            indicator.setShowText(settings.breathingText !== false);
            indicator.setOverTheme?.(settings.breathingOverTheme === true);

            // Start the animation
            indicator.start();
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
        const indicator = this._guide();
        if (indicator) {
            indicator.stop();
            this.breathingIndicatorActive = false;

            // Update Serenity Hub icon state
            if (this.serenityHub) {
                this.serenityHub.updateIconState({ breathingActive: false });
            }

            console.log('[Serenity] Breathing indicator stopped');
        }
    }

    /**
     * The guide was started or ended outside this mode's own controls (its End button, Escape,
     * the Hub). Keep the mode's flag and the saved preference in step with what is on screen.
     * @param {boolean} active
     */
    onBreathingGuideChange(active) {
        if (this.breathingIndicatorActive === active) return;
        this.breathingIndicatorActive = active;
        this.deps.settingsManager.update({ breathingGuideEnabled: active });
    }

    /**
     * Next breathing world. With the guide closed it chooses the world the guide opens on.
     * @private
     */
    _cycleBreathingTechnique() {
        const indicator = this._guide();
        if (!indicator || indicator.isExternallyControlled) return;

        // The guide steps through the worlds you have found and announces the change, which the
        // Hub saves as your choice.
        indicator.cycleTechnique(1);
        this.deps.settingsManager.update({ breathingTechnique: indicator.currentTechnique });
        if (!indicator.isActive) {
            const name = indicator.techniques?.[indicator.currentTechnique]?.name || 'Breathing';
            const key = this.keyFor('toggleBreathing');
            const keyName = key === 'Space' || key === ' ' ? 'Space' : key.toUpperCase();
            this._showNotification(`${name} · ${keyName} to begin`);
        }
    }

    /**
     * Show temporary notification
     * @private
     */
    _showNotification(message) {
        if (this.ui) this.ui.notice(message);
        else console.log('[Serenity]', message);
    }
}
