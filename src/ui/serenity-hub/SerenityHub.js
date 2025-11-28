/**
 * SerenityHub - Unified control panel for Serenity Mode
 *
 * Provides a beautiful, minimal interface for:
 * - Breathing technique selection
 * - Music player controls
 * - Theme browsing and switching
 */

import { BreathingTab } from './BreathingTab.js';
import { MusicTab } from './MusicTab.js';
import { ThemesTab } from './ThemesTab.js';
import { throttle } from '../../utils/performance-utils.js';
import { SpatialNavigation } from '../spatial-navigation.js';

export class SerenityHub {
    constructor(serenityMode) {
        this.serenityMode = serenityMode;
        this.isOpen = false;
        this.currentTab = 'themes'; // 'themes', 'music', 'breathing'

        // DOM elements
        this.hubIcon = null;
        this.settingsBtn = null;
        this.panel = null;
        this.backdrop = null;

        // Auto-hide behavior
        this.hideTimeout = null;
        this.hideDelay = 3000; // 3 seconds
        this.isMouseOverHub = false;
        this.isMouseOverSettings = false;

        // Tab instances
        this.breathingTab = null;
        this.musicTab = null;
        this.themesTab = null;

        // Gamepad support (uses global gamepadController from main app)
        this.gamepadCallbacks = null;

        // Pause/resume callbacks (set by main.js for pausing game in certain modes)
        this.onPauseCallback = null;
        this.onResumeCallback = null;

        // AbortController for easy event listener cleanup (Phase 6.3)
        // All event listeners use this signal - single abort() removes them all!
        this.abortController = new AbortController();

        // Track tab elements and their handlers separately (dynamic tabs)
        this.tabElements = [];
        this.tabAbortControllers = new Map(); // Per-tab AbortControllers

        this.init();
    }

    /**
   * Initialize the Serenity Hub
   */
    init() {
        this.createHubIcon();
        this.createSettingsButton();
        this.createPanel();
        this.attachEventListeners();
        this.setupAutoHide();

        // Setup gamepad controller integration
        this.setupGamepadIntegration();

        console.log('✨ Serenity Hub initialized with gamepad support');
    }

    /**
   * Create the floating hub icon (top-right corner)
   * If icon already exists in DOM (from index.html), use it instead of creating new one
   */
    createHubIcon() {
        // Check if icon already exists in the DOM (added via index.html)
        this.hubIcon = document.getElementById('serenity-hub-icon');

        if (!this.hubIcon) {
            // Create icon dynamically if it doesn't exist
            this.hubIcon = document.createElement('div');
            this.hubIcon.id = 'serenity-hub-icon';
            this.hubIcon.className = 'serenity-hub-icon visible';
            this.hubIcon.setAttribute('role', 'button');
            this.hubIcon.setAttribute('aria-label', 'Open Serenity Hub');
            this.hubIcon.setAttribute('tabindex', '0');

            this.hubIcon.innerHTML = `
        <svg class="hub-icon-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
          <!-- Lotus flower icon -->
          <g class="lotus">
            <!-- Center circle -->
            <circle cx="50" cy="60" r="8" fill="currentColor" opacity="0.9"/>

            <!-- Petals -->
            <path d="M 50 45 Q 35 50 30 65 Q 35 60 50 60" fill="currentColor" opacity="0.7"/>
            <path d="M 50 45 Q 65 50 70 65 Q 65 60 50 60" fill="currentColor" opacity="0.7"/>
            <path d="M 50 60 Q 40 70 35 80 Q 42 72 50 70" fill="currentColor" opacity="0.6"/>
            <path d="M 50 60 Q 60 70 65 80 Q 58 72 50 70" fill="currentColor" opacity="0.6"/>
            <path d="M 50 60 Q 45 75 40 85 Q 45 77 50 75" fill="currentColor" opacity="0.5"/>
            <path d="M 50 60 Q 55 75 60 85 Q 55 77 50 75" fill="currentColor" opacity="0.5"/>
          </g>
        </svg>
        <div class="hub-icon-glow"></div>
        <div class="hub-icon-pulse"></div>
      `;

            document.body.appendChild(this.hubIcon);
        }

        // Ensure it's visible
        this.hubIcon.classList.add('visible');

        // Store bound handler references
        this.hubIconClickHandler = () => this.toggle();

        this.hubIconKeydownHandler = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggle();
            }
        };

        this.hubIconMouseEnterHandler = () => {
            this.isMouseOverHub = true;
            this.cancelAutoHide();
        };

        this.hubIconMouseLeaveHandler = () => {
            this.isMouseOverHub = false;
            if (!this.isOpen) {
                this.startAutoHide();
            }
        };

        // Add event listeners with AbortController signal for easy cleanup
        const { signal } = this.abortController;
        this.hubIcon.addEventListener('click', this.hubIconClickHandler, { signal });
        this.hubIcon.addEventListener('keydown', this.hubIconKeydownHandler, { signal });
        this.hubIcon.addEventListener('mouseenter', this.hubIconMouseEnterHandler, { signal });
        this.hubIcon.addEventListener('mouseleave', this.hubIconMouseLeaveHandler, { signal });
    }

    /**
   * Create the floating settings button (bottom-right corner)
   */
    createSettingsButton() {
        this.settingsBtn = document.createElement('button');
        this.settingsBtn.id = 'serenity-settings-btn';
        this.settingsBtn.className = 'floating-settings-btn serenity-settings';
        this.settingsBtn.setAttribute('aria-label', 'Open Settings');

        this.settingsBtn.innerHTML = `
      <svg class="settings-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.2"/>
        <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
    `;

        // Store bound handler references
        this.settingsBtnClickHandler = () => {
            // Open settings modal
            const settingsModal = document.getElementById('settings-modal');
            if (settingsModal) {
                settingsModal.classList.add('visible');
            }
        };

        this.settingsBtnMouseEnterHandler = () => {
            this.isMouseOverSettings = true;
            this.cancelAutoHide();
        };

        this.settingsBtnMouseLeaveHandler = () => {
            this.isMouseOverSettings = false;
            if (!this.isOpen) {
                this.startAutoHide();
            }
        };

        // Add event listeners with AbortController signal
        const { signal } = this.abortController;
        this.settingsBtn.addEventListener('click', this.settingsBtnClickHandler, { signal });
        this.settingsBtn.addEventListener('mouseenter', this.settingsBtnMouseEnterHandler, { signal });
        this.settingsBtn.addEventListener('mouseleave', this.settingsBtnMouseLeaveHandler, { signal });

        document.body.appendChild(this.settingsBtn);
    }

    /**
   * Create the main panel with tabs
   */
    createPanel() {
        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'serenity-hub-backdrop';

        // Store handler reference
        this.backdropClickHandler = () => this.hide();
        this.backdrop.addEventListener('click', this.backdropClickHandler, { signal: this.abortController.signal });

        // Create panel
        this.panel = document.createElement('div');
        this.panel.id = 'serenity-hub-panel';
        this.panel.className = 'serenity-hub-panel';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-modal', 'true');
        this.panel.setAttribute('aria-labelledby', 'hub-title');

        this.panel.innerHTML = `
      <div class="hub-panel-header">
        <h2 id="hub-title" class="hub-title">Serenity Hub</h2>
        <button class="hub-close-btn" aria-label="Close Serenity Hub">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <nav class="hub-tabs" role="tablist">
        <button class="hub-tab active"
                data-tab="themes"
                role="tab"
                aria-selected="true"
                aria-controls="tab-themes">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4"></path>
          </svg>
          <span>Themes</span>
        </button>
        <button class="hub-tab"
                data-tab="music"
                role="tab"
                aria-selected="false"
                aria-controls="tab-music">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="16" r="3"></circle>
          </svg>
          <span>Music</span>
        </button>
        <button class="hub-tab"
                data-tab="breathing"
                role="tab"
                aria-selected="false"
                aria-controls="tab-breathing">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v12M6 12h12"></path>
          </svg>
          <span>Breathing</span>
        </button>
      </nav>

      <div class="hub-tab-content">
        <div id="tab-themes" class="tab-panel active" role="tabpanel" aria-labelledby="tab-themes">
          <div class="tab-loading">Loading themes...</div>
        </div>
        <div id="tab-music" class="tab-panel" role="tabpanel" aria-labelledby="tab-music">
          <div class="tab-loading">Loading music player...</div>
        </div>
        <div id="tab-breathing" class="tab-panel" role="tabpanel" aria-labelledby="tab-breathing">
          <div class="tab-loading">Loading breathing techniques...</div>
        </div>
      </div>
    `;

        // Store handler references
        this.closeBtnClickHandler = () => this.hide();
        this.panelClickHandler = (e) => {
            e.stopPropagation();
        };

        // Add close button handler with AbortController signal
        const { signal } = this.abortController;
        const closeBtn = this.panel.querySelector('.hub-close-btn');
        closeBtn.addEventListener('click', this.closeBtnClickHandler, { signal });

        // Prevent clicks inside panel from closing it
        this.panel.addEventListener('click', this.panelClickHandler, { signal });

        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.panel);
    }

    /**
   * Attach event listeners
   */
    attachEventListeners() {
        // Tab switching - use separate AbortControllers for each tab
        const tabs = this.panel.querySelectorAll('.hub-tab');
        this.tabElements = Array.from(tabs);

        tabs.forEach((tab) => {
            // Create AbortController for this tab
            const tabAbortController = new AbortController();
            const { signal } = tabAbortController;
            this.tabAbortControllers.set(tab, tabAbortController);

            const clickHandler = () => {
                const tabName = tab.dataset.tab;
                this.switchTab(tabName);
            };

            // Keyboard navigation for tabs
            const keydownHandler = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const tabName = tab.dataset.tab;
                    this.switchTab(tabName);
                }
            };

            // Add event listeners with AbortController signal
            tab.addEventListener('click', clickHandler, { signal });
            tab.addEventListener('keydown', keydownHandler, { signal });
        });

        // Use main AbortController for global listeners
        const { signal } = this.abortController;

        // Document keydown handler (ESC to close)
        this.documentKeydownHandler = (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.hide();
            }
        };
        document.addEventListener('keydown', this.documentKeydownHandler, { signal });

        // Panel mouse enter/leave handlers
        this.panelMouseEnterHandler = () => {
            this.isMouseOverHub = true;
            this.cancelAutoHide();
        };

        this.panelMouseLeaveHandler = () => {
            this.isMouseOverHub = false;
        };

        this.panel.addEventListener('mouseenter', this.panelMouseEnterHandler, { signal });
        this.panel.addEventListener('mouseleave', this.panelMouseLeaveHandler, { signal });
    }

    /**
   * Setup auto-hide behavior for the hub icon
   */
    setupAutoHide() {
        let mouseMoveTimeout = null;

        // Store document mousemove handler reference
        const mouseMoveHandler = () => {
            // Show icon on mouse movement
            this.showIcon();

            // Reset hide timeout
            clearTimeout(mouseMoveTimeout);

            if (!this.isOpen && !this.isMouseOverHub) {
                mouseMoveTimeout = setTimeout(() => {
                    this.startAutoHide();
                }, this.hideDelay);
            }
        };

        // Throttle mousemove to max once every 16ms (~60fps) to reduce CPU usage
        this.documentMouseMoveHandler = throttle(mouseMoveHandler, 16);

        // Use AbortController signal for easy cleanup
        document.addEventListener('mousemove', this.documentMouseMoveHandler, { signal: this.abortController.signal });
        console.log('[SerenityHub] Mousemove handler throttled to 16ms (~60fps)');

        // Initially hide after delay
        this.startAutoHide();
    }

    /**
   * Show the hub icon and settings button
   */
    showIcon() {
        this.hubIcon.classList.add('visible');
        if (this.settingsBtn) {
            this.settingsBtn.classList.add('visible');
        }
        this.cancelAutoHide();
    }

    /**
   * Start auto-hide timer for icon and settings button
   * DISABLED: Icon is now always visible everywhere
   */
    startAutoHide() {
        // Auto-hide disabled - icon is now always visible
        // this.cancelAutoHide();
        //
        // if (!this.isOpen && !this.isMouseOverHub && !this.isMouseOverSettings) {
        //   this.hideTimeout = setTimeout(() => {
        //     this.hubIcon.classList.remove('visible');
        //     if (this.settingsBtn) {
        //       this.settingsBtn.classList.remove('visible');
        //     }
        //   }, this.hideDelay);
        // }
    }

    /**
   * Cancel auto-hide timer
   */
    cancelAutoHide() {
        if (this.hideTimeout) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    /**
   * Switch to a different tab
   */
    switchTab(tabName) {
        if (this.currentTab === tabName) return;

        this.currentTab = tabName;

        // Update tab buttons
        const tabs = this.panel.querySelectorAll('.hub-tab');
        tabs.forEach((tab) => {
            const isActive = tab.dataset.tab === tabName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        // Update tab panels
        const panels = this.panel.querySelectorAll('.tab-panel');
        panels.forEach((panel) => {
            const isActive = panel.id === `tab-${tabName}`;
            panel.classList.toggle('active', isActive);
        });

        // Load tab content if needed
        this.loadTabContent(tabName);

        console.log(`Switched to ${tabName} tab`);
    }

    /**
   * Load content for a specific tab
   */
    async loadTabContent(tabName) {
        // Load breathing tab
        if (tabName === 'breathing' && !this.breathingTab) {
            if (window.breathingIndicator) {
                this.breathingTab = new BreathingTab(this, window.breathingIndicator);
                console.log('[SerenityHub] Breathing tab loaded');
            } else {
                console.warn('[SerenityHub] Breathing indicator not available');
            }
        }

        // Load music tab
        if (tabName === 'music' && !this.musicTab) {
            const soundManager = this.serenityMode.deps?.soundManager;
            if (soundManager) {
                this.musicTab = new MusicTab(this, soundManager);
                console.log('[SerenityHub] Music tab loaded');
            } else {
                console.warn('[SerenityHub] Sound manager not available');
                const panel = this.panel.querySelector(`#tab-${tabName}`);
                const loading = panel.querySelector('.tab-loading');
                if (loading) {
                    loading.textContent = 'Sound manager not available...';
                }
            }
        }

        // Load themes tab
        if (tabName === 'themes' && !this.themesTab) {
            const themeManager = this.serenityMode.deps?.themeManager;
            const settingsManager = this.serenityMode.deps?.settingsManager;
            if (themeManager && settingsManager) {
                this.themesTab = new ThemesTab(this, themeManager, settingsManager);
                console.log('[SerenityHub] Themes tab loaded');
            } else {
                console.warn('[SerenityHub] Theme manager or settings manager not available');
                const panel = this.panel.querySelector(`#tab-${tabName}`);
                const loading = panel.querySelector('.tab-loading');
                if (loading) {
                    loading.textContent = 'Theme manager not available...';
                }
            }
        }

        // Refresh theme tab if it's already loaded (in case theme changed externally)
        if (tabName === 'themes' && this.themesTab) {
            this.themesTab.refreshCurrentTheme();
        }

        // Refresh music tab if it's already loaded (in case music state changed)
        if (tabName === 'music' && this.musicTab) {
            this.musicTab.syncWithAudioState();
        }
    }

    /**
   * Set pause/resume callbacks (called by main.js)
   */
    setPauseResumeCallbacks(onPause, onResume) {
        this.onPauseCallback = onPause;
        this.onResumeCallback = onResume;
    }

    /**
   * Show the hub panel
   */
    show() {
        if (this.isOpen) return;

        this.isOpen = true;

        // Pause game if callback is set (for single player, local MP, infinity mode)
        if (this.onPauseCallback) {
            this.onPauseCallback();
        }

        // Show backdrop and panel
        this.backdrop.classList.add('visible');
        this.panel.classList.add('open');

        // Keep icon visible
        this.showIcon();
        this.cancelAutoHide();

        // Load current tab content if not loaded
        this.loadTabContent(this.currentTab);

        // Focus the panel for accessibility
        this.panel.focus();

        // Update icon state
        this.hubIcon.classList.add('active');
        this.hubIcon.setAttribute('aria-label', 'Close Serenity Hub');

        console.log('🎨 Serenity Hub opened');
    }

    /**
   * Hide the hub panel
   */
    hide() {
        if (!this.isOpen) return;

        this.isOpen = false;

        // Hide backdrop and panel
        this.backdrop.classList.remove('visible');
        this.panel.classList.remove('open');

        // Update icon state
        this.hubIcon.classList.remove('active');
        this.hubIcon.setAttribute('aria-label', 'Open Serenity Hub');

        // Resume game if callback is set (for single player, local MP, infinity mode)
        if (this.onResumeCallback) {
            this.onResumeCallback();
        }

        // Restart auto-hide
        this.startAutoHide();

        console.log('Serenity Hub closed');
    }

    /**
   * Toggle hub panel visibility
   */
    toggle() {
        if (this.isOpen) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
   * Update hub icon state based on Serenity Mode status
   */
    updateIconState(options = {}) {
        const { breathingActive = false, musicPlaying = false } = options;

        // Add breathing pulse animation if breathing is active
        const pulse = this.hubIcon.querySelector('.hub-icon-pulse');
        pulse.classList.toggle('breathing-active', breathingActive);

        // Add music playing indicator
        this.hubIcon.classList.toggle('music-playing', musicPlaying);
    }

    /**
   * Setup gamepad controller integration
   * Registers callbacks with the global gamepad controller
   */
    setupGamepadIntegration() {
        // Create callback functions for gamepad controller
        this.gamepadCallbacks = {
            toggleHub: () => this.toggle(),
            closeHub: () => this.hide(),
            isHubOpen: () => this.isOpen,

            // Tab navigation
            switchTabLeft: () => {
                const tabs = ['themes', 'music', 'breathing'];
                const currentIndex = tabs.indexOf(this.currentTab);
                const newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
                this.switchTab(tabs[newIndex]);
            },
            switchTabRight: () => {
                const tabs = ['themes', 'music', 'breathing'];
                const currentIndex = tabs.indexOf(this.currentTab);
                const newIndex = (currentIndex + 1) % tabs.length;
                this.switchTab(tabs[newIndex]);
            },

            // Item navigation
            navigate: (direction) => this.handleNavigation(direction),
            confirmSelection: () => this.confirmItem(),

            // Scrolling
            scrollContent: (delta) => {
                const activePanel = this.panel.querySelector('.tab-panel.active');
                if (activePanel) {
                    activePanel.scrollTop += delta;
                }
            },

            // Quick actions (work even when hub is closed)
            toggleBreathing: () => this.serenityMode._toggleBreathingIndicator(),
            nextBreathingTechnique: () => {
                if (window.breathingIndicator) {
                    console.log('[SerenityHub] Next breathing technique');
                    window.breathingIndicator.cycleTechnique(1);
                } else {
                    console.warn('[SerenityHub] Breathing indicator not available');
                }
            },
            previousBreathingTechnique: () => {
                if (window.breathingIndicator) {
                    console.log('[SerenityHub] Previous breathing technique');
                    window.breathingIndicator.cycleTechnique(-1);
                } else {
                    console.warn('[SerenityHub] Breathing indicator not available');
                }
            },
            randomTheme: () => this.serenityMode._randomTheme(),
            toggleFullscreen: () => this.serenityMode._toggleFullscreen(),
            previousTrack: () => this.serenityMode.deps?.soundManager?.previousTrack?.(),
            nextTrack: () => this.serenityMode.deps?.soundManager?.nextTrack?.(),

            // Volume control
            volumeDown: () => {
                const soundManager = this.serenityMode.deps?.soundManager;
                if (soundManager) {
                    const current = soundManager.musicVolume || 0.5;
                    soundManager.setMusicVolume(Math.max(0, current - 0.02));
                }
            },
            volumeUp: () => {
                const soundManager = this.serenityMode.deps?.soundManager;
                if (soundManager) {
                    const current = soundManager.musicVolume || 0.5;
                    soundManager.setMusicVolume(Math.min(1, current + 0.02));
                }
            },

            // Button hints overlay
            toggleHints: () => this.toggleButtonHints(),

            // NOTE: START button for opening settings is handled globally by toggleSettings,
            // not here to avoid conflicts between menu navigation and Serenity Mode
        };

        // Register with gamepad controller from dependencies
        const gamepadController = this.serenityMode.deps?.gamepadController;
        if (gamepadController) {
            gamepadController.enableSerenityMode(this.gamepadCallbacks);
            console.log('[SerenityHub] Gamepad callbacks registered');
        } else {
            console.warn('[SerenityHub] Gamepad controller not available in dependencies');
        }
    }

    /**
   * Handle spatial navigation
   * @param {'up'|'down'|'left'|'right'} direction
   */
    handleNavigation(direction) {
        if (!this.isOpen) return;

        const activePanel = this.panel.querySelector('.tab-panel.active');
        if (!activePanel) return;

        const currentElement = document.activeElement;

        // If focus is not in panel, focus first element
        if (!this.panel.contains(currentElement)) {
            const first = SpatialNavigation.getFocusableElements(activePanel)[0];
            if (first) first.focus();
            return;
        }

        const nextElement = SpatialNavigation.findNextElement(currentElement, direction, activePanel);
        if (nextElement) {
            nextElement.focus();
            nextElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    /**
     * Confirm focused item
     */
    confirmItem() {
        const focusedItem = document.activeElement;
        if (focusedItem && this.panel.contains(focusedItem)) {
            focusedItem.click();
        }
    }

    /**
   * Toggle button hints overlay
   */
    toggleButtonHints() {
        let hintsOverlay = document.getElementById('gamepad-hints-overlay');

        if (!hintsOverlay) {
            // Detect if gamepad is connected
            const gamepadController = this.serenityMode.deps?.gamepadController;
            const connectionStatus = gamepadController?.getConnectionStatus?.();
            const hasGamepad = connectionStatus?.controller1?.connected || connectionStatus?.controller2?.connected || false;

            // Create hints overlay
            hintsOverlay = document.createElement('div');
            hintsOverlay.id = 'gamepad-hints-overlay';
            hintsOverlay.className = 'gamepad-hints visible';

            if (hasGamepad) {
                // Show gamepad controls
                hintsOverlay.innerHTML = `
          <div class="hint-title">🎮 Serenity Mode Controls</div>
          <div class="hint-grid">
            <div class="hint-item"><span class="hint-button">Y</span> Toggle Hub</div>
            <div class="hint-item"><span class="hint-button">X</span> Breathing</div>
            <div class="hint-item"><span class="hint-button">D▲</span> Prev Technique</div>
            <div class="hint-item"><span class="hint-button">D▼</span> Next Technique</div>
            <div class="hint-item"><span class="hint-button">L3</span> Random Theme</div>
            <div class="hint-item"><span class="hint-button">R3</span> Fullscreen</div>
            <div class="hint-item"><span class="hint-button">LB</span> Prev Track</div>
            <div class="hint-item"><span class="hint-button">RB</span> Next Track</div>
            <div class="hint-item"><span class="hint-button">LT</span> Volume Down</div>
            <div class="hint-item"><span class="hint-button">RT</span> Volume Up</div>
            <div class="hint-item"><span class="hint-button">Start</span> Settings</div>
            <div class="hint-item"><span class="hint-button">Select</span> Hide Hints</div>
          </div>
          <div class="hint-title" style="margin-top: 15px;">When Hub is Open</div>
          <div class="hint-grid">
            <div class="hint-item"><span class="hint-button">A</span> Confirm</div>
            <div class="hint-item"><span class="hint-button">B</span> Close Hub</div>
            <div class="hint-item"><span class="hint-button">D-Pad</span> Navigate</div>
            <div class="hint-item"><span class="hint-button">LB/RB</span> Switch Tab</div>
            <div class="hint-item"><span class="hint-button">R-Stick</span> Scroll</div>
          </div>
          <div class="hint-footer">Press SELECT again to hide</div>
        `;
            } else {
                // Show keyboard controls
                hintsOverlay.innerHTML = `
          <div class="hint-title">⌨️ Serenity Mode Controls</div>
          <div class="hint-grid">
            <div class="hint-item"><span class="hint-button">H</span> Toggle Hub</div>
            <div class="hint-item"><span class="hint-button">Space</span> Breathing Guide</div>
            <div class="hint-item"><span class="hint-button">T</span> Cycle Technique</div>
            <div class="hint-item"><span class="hint-button">M</span> Next Track</div>
            <div class="hint-item"><span class="hint-button">B</span> Random Theme</div>
            <div class="hint-item"><span class="hint-button">F</span> Fullscreen</div>
            <div class="hint-item"><span class="hint-button">/</span> Toggle Hints</div>
            <div class="hint-item"><span class="hint-button">ESC</span> Exit to Menu</div>
          </div>
          <div class="hint-title" style="margin-top: 15px;">When Hub is Open</div>
          <div class="hint-grid">
            <div class="hint-item"><span class="hint-button">Click</span> Select Item</div>
            <div class="hint-item"><span class="hint-button">H/ESC</span> Close Hub</div>
            <div class="hint-item"><span class="hint-button">Mouse</span> Navigate</div>
            <div class="hint-item"><span class="hint-button">Scroll</span> Browse Lists</div>
          </div>
          <div class="hint-footer">Press / again to hide</div>
        `;
            }

            document.body.appendChild(hintsOverlay);

            // Auto-hide after 10 seconds
            setTimeout(() => {
                if (hintsOverlay && hintsOverlay.parentNode) {
                    hintsOverlay.classList.remove('visible');
                    setTimeout(() => hintsOverlay.remove(), 300);
                }
            }, 10000);
        } else {
            // Toggle visibility
            if (hintsOverlay.classList.contains('visible')) {
                hintsOverlay.classList.remove('visible');
                setTimeout(() => hintsOverlay.remove(), 300);
            }
        }
    }

    /**
   * Destroy the hub and clean up
   */
    destroy() {
        console.log('[SerenityHub] Starting cleanup...');

        // Clear timers
        this.cancelAutoHide();

        // Disable gamepad integration
        const gamepadController = this.serenityMode.deps?.gamepadController;
        if (gamepadController) {
            gamepadController.disableSerenityMode();
            console.log('[SerenityHub] Gamepad integration disabled');
        }

        // ✨ PHASE 6.3: AbortController Pattern - Remove ALL event listeners with ONE line!
        console.log('[SerenityHub] Aborting all event listeners via AbortController...');
        if (this.abortController) {
            this.abortController.abort();
            console.log('  ✅ Main AbortController aborted (hub icon, backdrop, panel, document listeners)');
        }

        // Abort all tab-specific listeners
        if (this.tabAbortControllers.size > 0) {
            for (const [tab, controller] of this.tabAbortControllers.entries()) {
                controller.abort();
            }
            console.log(`  ✅ ${this.tabAbortControllers.size} tab AbortControllers aborted`);
            this.tabAbortControllers.clear();
        }

        // Clear tab tracking
        this.tabElements = [];

        // Remove DOM elements (but keep hubIcon since it's permanent in index.html)
        // Don't remove hubIcon - it's a permanent element now
        // Just clear the reference and let event listeners be cleaned up by AbortController
        this.hubIcon = null;
        if (this.settingsBtn) {
            this.settingsBtn.remove();
            this.settingsBtn = null;
        }
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }

        // Clean up tab instances
        if (this.breathingTab) {
            if (typeof this.breathingTab.destroy === 'function') {
                this.breathingTab.destroy();
            } else {
                console.warn('[SerenityHub] BreathingTab missing destroy method');
            }
            this.breathingTab = null;
        }
        if (this.musicTab) {
            if (typeof this.musicTab.destroy === 'function') {
                this.musicTab.destroy();
            } else {
                console.warn('[SerenityHub] MusicTab missing destroy method');
            }
            this.musicTab = null;
        }
        if (this.themesTab) {
            if (typeof this.themesTab.destroy === 'function') {
                this.themesTab.destroy();
            } else {
                console.warn('[SerenityHub] ThemesTab missing destroy method');
            }
            this.themesTab = null;
        }

        // Null out AbortController and references (Phase 6.1: Null Reference Cleanup)
        this.abortController = null;
        this.gamepadCallbacks = null;
        this.serenityMode = null;

        console.log('✅ [SerenityHub] Destroyed - all listeners removed via AbortController');
    }
}
