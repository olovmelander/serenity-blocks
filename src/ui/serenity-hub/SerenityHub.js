/**
 * SerenityHub - the sheet that holds themes, music, breathing and Hale sessions.
 *
 * Keystone layout (public/styles/keystone-hub.css, docs/MENU_UI_OVERHAUL_2026-10.md): an
 * eyebrow and title, a labelled close control, a tab strip, the scrolling content, and an
 * input-hint footer. The sheet's top-right corner is open and holds the keystone.
 * Each tab is its own module and builds its content on first use.
 */

import { BreathingTab } from './BreathingTab.js';
import { MusicTab } from './MusicTab.js';
import { ThemesTab } from './ThemesTab.js';
import { SessionsTab } from './SessionsTab.js';
import { BreathworkSessionManager } from '../effects/breathwork-session-manager.js';
import { throttle } from '../../utils/performance-utils.js';
import { SpatialNavigation } from '../spatial-navigation.js';
import {
    resolveHubScrollContainer,
    scrollHubElementIntoView,
    scrollHubScrollContainer,
    scrollHubScrollContainerFromWheelEvent,
} from './hub-scroll-utils.js';
import { csIcon } from '../components/cosmic-icons.js';

/** The Hub's sections in strip order. The eyebrow follows the main menu's "Breath · …" voice. */
const HUB_TABS = Object.freeze([
    {
        id: 'themes', label: 'Themes', eyebrow: 'Breath · The world you play in', icon: 'galaxy',
    },
    {
        id: 'music', label: 'Music', eyebrow: 'Breath · What you hear', icon: 'note',
    },
    {
        id: 'breathing', label: 'Breathing', eyebrow: 'Breath · Rhythms to follow', icon: 'breath',
    },
    {
        id: 'sessions',
        label: 'Hale sessions',
        eyebrow: 'Breath · Guided journeys',
        icon: 'hale-base',
        ariaLabel: 'Hale sessions · guided breathwork',
    },
]);
const HUB_TAB_IDS = HUB_TABS.map((tab) => tab.id);

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

/** One keycap; `kind` 'key' or 'pad' lets the body's input class choose which one shows. */
const keycap = (label, kind = '') => `<kbd class="sb-kbd"${kind ? ` data-${kind}` : ''}>${label}</kbd>`;

/** Serenity's default bindings; the player's own (settings) are laid over them. */
const DEFAULT_PAD_BINDINGS = Object.freeze({
    toggleHub: 3,
    toggleBreathing: 2,
    randomTheme: 10,
    toggleFullscreen: 11,
    previousTrack: 4,
    nextTrack: 5,
    volumeDown: 6,
    volumeUp: 7,
    toggleControlHints: 8,
    openSettings: 9,
    previousBreathingTechnique: 12,
    nextBreathingTechnique: 13,
    confirmSelection: 0,
    closeHub: 1,
    navigateLeft: 14,
    navigateRight: 15,
});
const DEFAULT_KEY_BINDINGS = Object.freeze({
    toggleHub: 'h',
    toggleBreathing: 'Space',
    cycleBreathingTechnique: 't',
    randomTheme: 'b',
    toggleFullscreen: 'f',
    toggleControlHints: '/',
    exitToMenu: 'Escape',
});
const PAD_BUTTON_NAMES = Object.freeze({
    0: 'A',
    1: 'B',
    2: 'X',
    3: 'Y',
    4: 'LB',
    5: 'RB',
    6: 'LT',
    7: 'RT',
    8: 'Select',
    9: 'Start',
    10: 'L3',
    11: 'R3',
    12: 'D-Up',
    13: 'D-Down',
    14: 'D-Left',
    15: 'D-Right',
    16: 'Home',
});

function formatKeyName(key = '') {
    const name = String(key);
    if (name === ' ' || name.toLowerCase() === 'space') return 'Space';
    if (name === 'Escape') return 'Esc';
    return name.length === 1 ? name.toUpperCase() : name;
}

export class SerenityHub {
    constructor(serenityMode) {
        this.serenityMode = serenityMode;
        this.originalSerenityMode = serenityMode;
        this.isOpen = false;
        this.currentTab = 'themes'; // 'themes', 'music', 'breathing'

        // DOM elements
        this.hubIcon = null;
        this.haleSessionsEntry = null;
        this.settingsBtn = null;
        this.panel = null;
        this.backdrop = null;

        // Auto-hide behavior
        this.hideTimeout = null;
        this.hideDelay = 3000; // 3 seconds
        this.isMouseOverHub = false;
        this.isMouseOverSettings = false;
        this.autoHideEnabled = false;

        // Scroll performance mode state
        this.scrollIdleDelay = 380;
        this.scrollIdleTimeout = null;
        this.scrollRafId = null;

        // Tab instances
        this.breathingTab = null;
        this.musicTab = null;
        this.themesTab = null;
        this.sessionsTab = null;
        this.sessionManager = null;

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
        this.createHaleSessionsEntry();
        this.createSettingsButton();
        this.createPanel();
        this.attachEventListeners();
        this.setupAutoHide();

        // Setup gamepad controller integration
        this.setupGamepadIntegration();

        console.log('✨ Serenity Hub initialized with gamepad support');
    }

    /**
   * The Hub's in-game tile. index.html provides it and the play rail
   * (src/ui/keystone/play-rail.js) gives it its place; this only recreates it, with the
   * same line lotus, if the page lacks one.
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
            this.hubIcon.setAttribute('aria-label', 'Serenity Hub');
            this.hubIcon.setAttribute('tabindex', '0');

            this.hubIcon.innerHTML = `
        <svg class="sb-play-rail__icon" viewBox="0 0 24 24" width="20" height="20" fill="none"
          stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
          aria-hidden="true" focusable="false">
          <path d="M12 5.3c-1.6 1.3-2.5 3.1-2.5 5.2 0 1.2.4 2.4 1 3.3"/>
          <path d="M12 5.3c1.6 1.3 2.5 3.1 2.5 5.2 0 1.2-.4 2.4-1 3.3"/>
          <path d="M7.4 9.6c-1.3.7-2.4 1.8-3 3.4 1.3.3 2.8.1 4.1-.7"/>
          <path d="M16.6 9.6c1.3.7 2.4 1.8 3 3.4-1.3.3-2.8.1-4.1-.7"/>
          <path d="M4.1 16.9c2.4 1.7 5 2.5 7.9 2.5s5.5-.8 7.9-2.5"/>
        </svg>
        <div class="hub-icon-pulse"></div>
      `;

            document.body.appendChild(this.hubIcon);
        }

        // Ensure it's visible
        this.hubIcon.classList.add('visible');
        this.hubIcon.classList.add('serenity-hub');

        // Store bound handler references
        this.hubIconClickHandler = () => this.toggle();

        this.hubIconKeydownHandler = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
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

    /** The Hub's programmatic route to guided sessions (not shown: Hale lives in the Hub's
     * own tab, one tap on the lotus in the play rail, and in the main menu's list). */
    createHaleSessionsEntry() {
        if (this.haleSessionsEntry) return;
        const button = document.getElementById('hale-sessions-btn') || document.createElement('button');
        button.id = 'hale-sessions-btn';
        button.type = 'button';
        button.className = 'hale-sessions-entry serenity-hub';
        button.setAttribute('aria-label', 'Hale sessions · guided breathwork');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'serenity-hub-panel');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = `<span class="hale-sessions-entry__icon">${csIcon('hale-base', 20)}</span>`
            + '<span class="hale-sessions-entry__text">'
            + '<strong>Hale sessions</strong><small>Guided breathwork</small></span>';
        const { signal } = this.abortController;
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            this.openHaleSessions();
        }, { signal });
        button.addEventListener('keydown', (event) => {
            if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
        }, { signal });
        this.haleSessionsEntry = button;
        if (!button.parentNode) document.body.appendChild(button);
    }

    openHaleSessions() {
        if (!this.panel) return;
        this.switchTab('sessions');
        this.show();
    }

    /** Release every breathing surface when the application leaves or activates a mode. */
    cancelGuidedSession() {
        if (this.sessionsTab) this.sessionsTab.cancelForModeChange();
        else this.sessionManager?.stopSession();
        // A standalone practice belongs to the mode it was started in.
        const guide = window.breathingIndicator;
        if (guide?.isActive && !guide.isExternallyControlled) guide.stop();
        this.hide({ resumeGameplay: false });
    }

    /**
     * True while breathing owns the screen: a Hale session, its preparation or result, or a
     * standalone practice. Falling-block gameplay stays paused for as long as this holds.
     */
    holdsGameplay() {
        return Boolean(this.sessionManager?.activeSession || this.sessionsTab?.holdsScreen
            || window.breathingIndicator?.isActive);
    }

    /** Resume gameplay once nothing breathing-related is on screen any more. */
    releaseGameplay() {
        if (!this.isOpen && !this.holdsGameplay()) this.onResumeCallback?.();
    }

    /** The guide started or stopped (possibly by its own End control or the Escape key). */
    onBreathingGuideChange(detail = {}) {
        const active = Boolean(detail.active);
        if (this.haleSessionsEntry) this.haleSessionsEntry.hidden = active || this.isOpen;
        if (!detail.session) this.serenityMode?.onBreathingGuideChange?.(active);
        if (!active) this.releaseGameplay();
    }

    /**
   * Create the floating settings button (bottom-right corner)
   */
    /**
   * Setup the settings button (uses global button)
   */
    createSettingsButton() {
        // Use the global settings button instead of creating a new one
        this.settingsBtn = document.getElementById('settings-btn-global');

        if (this.settingsBtn) {
            // Add serenity-settings class for styling hooks
            this.settingsBtn.classList.add('serenity-settings');

            // Note: Click handler is managed globally by modals.js
            // Auto-hide handlers are attached below if needed

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
            this.settingsBtn.addEventListener('mouseenter', this.settingsBtnMouseEnterHandler, { signal });
            this.settingsBtn.addEventListener('mouseleave', this.settingsBtnMouseLeaveHandler, { signal });
        }
    }

    /**
   * Create the main panel with tabs
   */
    createPanel() {
        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'serenity-hub-backdrop';
        this.backdrop.dataset.wheelLock = 'true';

        // Store handler reference
        this.backdropClickHandler = () => this.hide();
        this.backdrop.addEventListener('click', this.backdropClickHandler, { signal: this.abortController.signal });

        // Create panel
        this.panel = document.createElement('div');
        this.panel.id = 'serenity-hub-panel';
        this.panel.className = 'serenity-hub-panel serenity-hub';
        this.panel.setAttribute('role', 'dialog');
        this.panel.setAttribute('aria-modal', 'true');
        this.panel.setAttribute('aria-labelledby', 'hub-title');
        this.panel.setAttribute('tabindex', '-1');
        this.panel.dataset.wheelLock = 'true';
        this.panel.dataset.tab = this.currentTab;

        const current = HUB_TABS.find((tab) => tab.id === this.currentTab) || HUB_TABS[0];
        const tabs = HUB_TABS.map((tab) => {
            const selected = tab.id === current.id;
            return `<button type="button" id="hub-tab-${tab.id}" class="hub-tab${selected ? ' active' : ''}"
                    data-tab="${tab.id}" role="tab" aria-selected="${selected}" aria-controls="tab-${tab.id}"
                    tabindex="${selected ? 0 : -1}"${tab.ariaLabel ? ` aria-label="${escapeHtml(tab.ariaLabel)}"` : ''}>
                <span class="hub-tab__icon" aria-hidden="true">${csIcon(tab.icon, 16)}</span>
                <span class="hub-tab__label">${escapeHtml(tab.label)}</span>
            </button>`;
        }).join('');
        const panels = HUB_TABS.map((tab) => `
            <div id="tab-${tab.id}" class="tab-panel${tab.id === current.id ? ' active' : ''}" role="tabpanel"
                aria-labelledby="hub-tab-${tab.id}">
                <div class="tab-loading">Loading ${escapeHtml(tab.label.toLowerCase())}…</div>
            </div>`).join('');

        // The keystone sits in the sheet's open top-right corner (the fill is masked, not this).
        this.panel.innerHTML = `
            <span class="hub-key" aria-hidden="true"></span>
            <header class="hub-panel-header">
                <div class="hub-heading">
                    <p class="sb-eyebrow hub-eyebrow">${escapeHtml(current.eyebrow)}</p>
                    <h2 id="hub-title" class="hub-title" tabindex="-1" data-keystone="none">Serenity Hub</h2>
                </div>
                <button type="button" class="hub-close-btn" aria-label="Close Serenity Hub" aria-keyshortcuts="Escape">
                    <svg class="hub-close-btn__icon" viewBox="0 0 24 24" width="16" height="16" fill="none"
                        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                        <path d="M6.5 6.5l11 11M17.5 6.5l-11 11"></path>
                    </svg>
                    <span class="hub-close-btn__label">Close</span>
                    ${keycap('Esc', 'key')}${keycap('B', 'pad')}
                </button>
            </header>
            <nav class="hub-tabs" role="tablist" aria-label="Serenity Hub sections">${tabs}</nav>
            <div class="hub-tab-content" data-wheel-lock="true">${panels}</div>
            <footer class="hub-footer">
                <ul class="sb-hints" aria-label="Controls">
                    <li>${keycap('&larr;', 'key')}${keycap('&rarr;', 'key')}${keycap('LB', 'pad')}${keycap('RB', 'pad')}
                        Switch tabs</li>
                    <li>${keycap('Enter', 'key')}${keycap('A', 'pad')}Choose</li>
                    <li>${keycap('Esc', 'key')}${keycap('B', 'pad')}Close</li>
                </ul>
            </footer>
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

        // Scroll Optimization: Detect scrolling to disable hover effects
        const scrollContainer = this.getScrollContainer();
        if (scrollContainer) {
            this.tabContentScrollHandler = () => {
                if (this.scrollRafId !== null) return;
                this.scrollRafId = requestAnimationFrame(() => {
                    this.scrollRafId = null;
                    this.setScrollPerformanceMode(true);
                    if (this.scrollIdleTimeout) {
                        clearTimeout(this.scrollIdleTimeout);
                    }
                    this.scrollIdleTimeout = setTimeout(() => {
                        this.scrollIdleTimeout = null;
                        this.setScrollPerformanceMode(false);
                    }, this.scrollIdleDelay);
                });
            };
            this.tabContentWheelHandler = (event) => {
                if (!this.isOpen) {
                    return;
                }

                const didScroll = scrollHubScrollContainerFromWheelEvent(this.panel, event);
                if (didScroll) {
                    this.tabContentScrollHandler?.();
                }
            };

            scrollContainer.addEventListener('scroll', this.tabContentScrollHandler, {
                passive: true,
                signal: this.abortController.signal,
            });
            scrollContainer.addEventListener('wheel', this.tabContentWheelHandler, {
                passive: false,
                signal: this.abortController.signal,
            });
        }

        // Document-level capture-phase wheel listener for Electron.
        // In Electron's Chromium compositor, event.target can resolve to the canvas
        // beneath the hub panel. Since the hub isn't in the canvas's ancestor chain,
        // the hub's scroll container wheel listener never fires. This capture listener
        // uses elementFromPoint to detect when the cursor is actually over the hub panel
        // and forwards the scroll event to the hub's scroll container.
        this.documentWheelCaptureHandler = (event) => {
            if (!this.isOpen || !this.panel) return;

            const topElement = (Number.isFinite(event.clientX) && Number.isFinite(event.clientY))
                ? document.elementFromPoint(event.clientX, event.clientY)
                : null;
            if (!topElement) return;

            // Check if the topmost element is inside the hub panel
            if (!this.panel.contains(topElement)) return;

            // Already handled by the scroll container's own listener
            if (event.target && this.panel.contains(event.target)) return;

            const didScroll = scrollHubScrollContainerFromWheelEvent(this.panel, event);
            if (didScroll) {
                this.tabContentScrollHandler?.();
            }
        };
        document.addEventListener('wheel', this.documentWheelCaptureHandler, {
            capture: true,
            passive: false,
            signal: this.abortController.signal,
        });
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

            // Keyboard navigation for tabs: Enter/Space choose, arrows and Home/End walk the strip.
            const keydownHandler = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    const tabName = tab.dataset.tab;
                    this.switchTab(tabName);
                } else if (this.stepTab(e.key, tab.dataset.tab, { focus: true })) {
                    e.preventDefault();
                    e.stopPropagation();
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
                e.preventDefault();
                // Other document-level mode handlers also bind Escape (for
                // example Serenity Mode's exit-to-menu action). The topmost
                // Hub owns this keypress; do not let one action both close the
                // panel and stop/deactivate the current game mode.
                e.stopImmediatePropagation();
                if (!this.themesTab?.closeCollectionDetails?.()) this.hide();
            } else if (this.isOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
                && this.isSheetFocused() && this.stepTab(e.key, this.currentTab, { focus: true })) {
                // Just opened (focus on the title or the sheet): the arrows switch tabs at once.
                e.preventDefault();
            }
        };
        document.addEventListener('keydown', this.documentKeydownHandler, { signal });
        // Native activation inside the sheet must not also reach a mode's global shortcuts
        // (Serenity Mode binds Space to the breathing guide).
        this.panel.addEventListener('keydown', (e) => {
            if ((e.key === ' ' || e.key === 'Enter')
                && e.target?.closest?.('button, input, select, textarea, [role="button"], [role="slider"]')) {
                e.stopPropagation();
            }
        }, { signal });
        document.addEventListener('visibilitychange', () => {
            const visible = this.isOpen && !document.hidden;
            this.themesTab?.setActive(visible && this.currentTab === 'themes');
            this.sessionsTab?.setActive(visible && this.currentTab === 'sessions');
        }, { signal });
        window.addEventListener('breathingGuideChange', (event) => this.onBreathingGuideChange(event.detail), { signal });
        // The guide can change world on its own (arrow keys, a gamepad): remember the choice.
        window.addEventListener('breathingTechniqueChange', (event) => {
            this.serenityMode?.deps?.settingsManager?.update?.({ breathingTechnique: event.detail?.id });
        }, { signal });

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
        if (!this.autoHideEnabled) {
            this.showIcon();
            return;
        }

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
     * Toggle temporary lightweight visual mode during active scrolling
     * @param {boolean} enabled
     */
    setScrollPerformanceMode(enabled) {
        const isEnabled = enabled && this.isOpen;
        this.panel?.classList.toggle('is-scrolling', isEnabled);
        this.backdrop?.classList.toggle('is-scrolling', isEnabled);
    }

    getScrollContainer() {
        return resolveHubScrollContainer(this.panel);
    }

    /**
     * Clear all scroll performance mode timers and classes
     */
    clearScrollPerformanceMode() {
        if (this.scrollIdleTimeout) {
            clearTimeout(this.scrollIdleTimeout);
            this.scrollIdleTimeout = null;
        }
        if (this.scrollRafId !== null) {
            cancelAnimationFrame(this.scrollRafId);
            this.scrollRafId = null;
        }
        this.setScrollPerformanceMode(false);
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

        this.musicTab?.setActive(false);
        this.themesTab?.setActive(false);
        this.sessionsTab?.setActive(false);
        // The tabs share one scroll container: each keeps its own place.
        const scroller = this.getScrollContainer?.();
        if (scroller) {
            this.tabScrollPositions ||= new Map();
            this.tabScrollPositions.set(this.currentTab, scroller.scrollTop);
        }
        this.currentTab = tabName;
        if (this.panel.dataset) this.panel.dataset.tab = tabName;
        const eyebrow = this.panel.querySelector?.('.hub-eyebrow');
        const spec = HUB_TABS.find((tab) => tab.id === tabName);
        if (eyebrow && spec) eyebrow.textContent = spec.eyebrow;

        // Update tab buttons (roving tabindex: only the selected tab is in the Tab order)
        const tabs = this.panel.querySelectorAll('.hub-tab');
        tabs.forEach((tab) => {
            const isActive = tab.dataset.tab === tabName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
            tab.tabIndex = isActive ? 0 : -1;
        });
        this.revealActiveTab();

        // Update tab panels
        const panels = this.panel.querySelectorAll('.tab-panel');
        panels.forEach((panel) => {
            const isActive = panel.id === `tab-${tabName}`;
            panel.classList.toggle('active', isActive);
        });
        if (scroller) scroller.scrollTop = this.tabScrollPositions.get(tabName) || 0;

        // Load tab content if needed
        this.loadTabContent(tabName);

        console.log(`Switched to ${tabName} tab`);
    }

    /** Focus rests on the sheet itself or its title (where it lands when the Hub opens). */
    isSheetFocused() {
        const active = typeof document !== 'undefined' ? document.activeElement : null;
        return Boolean(active) && (active === this.panel || active.id === 'hub-title');
    }

    /**
     * Arrow keys and Home/End walk the tab strip (the ARIA tabs pattern, choosing as they go).
     * @returns {boolean} true when the key chose another tab
     */
    stepTab(key, fromTab = this.currentTab, { focus = false } = {}) {
        const count = HUB_TAB_IDS.length;
        const index = Math.max(0, HUB_TAB_IDS.indexOf(fromTab));
        const target = {
            ArrowRight: (index + 1) % count, ArrowLeft: (index - 1 + count) % count, Home: 0, End: count - 1,
        }[key];
        if (target === undefined) return false;
        const tabName = HUB_TAB_IDS[target];
        this.switchTab(tabName);
        if (focus) this.panel?.querySelector?.(`#hub-tab-${tabName}`)?.focus?.({ preventScroll: true });
        return true;
    }

    /** Keep a selected tab visible without scrolling the Hub's dialog content. */
    revealActiveTab() {
        const nav = this.panel?.querySelector('.hub-tabs');
        const tab = nav?.querySelector('.hub-tab[aria-selected="true"]');
        if (!tab || !nav.clientWidth) return;
        const left = tab.offsetLeft - (tab.offsetParent === nav ? 0 : nav.offsetLeft);
        const right = left + tab.offsetWidth;
        if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left);
        else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
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

        if (tabName === 'breathing') this.breathingTab?.refresh();

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

        // Load sessions tab
        if (tabName === 'sessions' && !this.sessionsTab) {
            if (window.breathingIndicator) {
                if (!this.sessionManager) {
                    this.sessionManager = new BreathworkSessionManager(window.breathingIndicator);
                }
                this.sessionsTab = new SessionsTab(this, this.sessionManager);
                console.log('[SerenityHub] Sessions tab loaded');
            } else {
                console.warn('[SerenityHub] Breathing indicator not available for sessions');
            }
        }

        // Refresh theme tab if it's already loaded (in case theme changed externally)
        if (tabName === 'themes' && this.themesTab) {
            this.themesTab.setActive(this.isOpen && this.currentTab === 'themes' && !document.hidden);
        }

        this.sessionsTab?.setActive(this.isOpen && this.currentTab === 'sessions' && !document.hidden);

        // Refresh music tab if it's already loaded (in case music state changed)
        if (tabName === 'music' && this.musicTab) {
            this.musicTab.setActive(this.isOpen && this.currentTab === 'music' && !document.hidden);
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
     * Update the active mode context for the hub and all loaded tabs
     * @param {Object} mode - The new mode context (e.g. SerenityMode instance or hubWrapper)
     */
    setMode(mode) {
        this.serenityMode = mode;
        if (this.breathingTab) this.breathingTab.serenityMode = mode;
        if (this.musicTab) this.musicTab.serenityMode = mode;
        if (this.themesTab) this.themesTab.serenityMode = mode;
    }

    /**
     * Reset the mode context back to the original wrapper
     */
    resetModeToOriginal() {
        this.setMode(this.originalSerenityMode);
    }

    /**
   * Show the hub panel
   */
    show() {
        if (this.isOpen) return;

        this.clearScrollPerformanceMode();
        this.isOpen = true;
        if (this.haleSessionsEntry) {
            this.haleSessionsEntry.hidden = true;
            this.haleSessionsEntry.setAttribute('aria-expanded', 'true');
        }

        // Notify Serenity Mode to lower quality
        if (this.serenityMode && typeof this.serenityMode.onHubOpen === 'function') {
            this.serenityMode.onHubOpen();
        }

        // Pause game if callback is set (for single player, local MP, infinity mode)
        if (this.onPauseCallback) {
            this.onPauseCallback();
        }

        // Show backdrop and panel
        this.backdrop.classList.add('visible');
        this.panel.classList.add('open');
        document.body.classList.add('serenity-hub-open');
        this.revealActiveTab();

        // Keep icon visible
        this.showIcon();
        this.cancelAutoHide();

        // Hide global settings button — hub backdrop (z-index: 1999) blocks it,
        // and the hub provides its own settings access
        if (this.settingsBtn) {
            this.settingsBtn.style.visibility = 'hidden';
            this.settingsBtn.style.pointerEvents = 'none';
        }

        // Load current tab content if not loaded
        this.loadTabContent(this.currentTab);

        // Focus lands on the title: a screen reader hears the dialog's name, and the arrow
        // keys switch tabs from here (the keystone marker skips it: data-keystone="none").
        const title = this.panel.querySelector?.('#hub-title');
        if (title?.focus) title.focus({ preventScroll: true });
        else this.panel.focus();

        // Update icon state
        this.hubIcon.classList.add('active');
        this.hubIcon.setAttribute('aria-label', 'Close Serenity Hub');

        window.dispatchEvent(new CustomEvent('serenityHubVisibilityChange', {
            detail: {
                visible: true,
                currentTab: this.currentTab,
            },
        }));

        console.log('🎨 Serenity Hub opened');
    }

    /**
   * Hide the hub panel
   */
    hide({ resumeGameplay = true } = {}) {
        if (!this.isOpen) {
            this.clearScrollPerformanceMode();
            return;
        }

        this.isOpen = false;
        if (this.haleSessionsEntry) {
            this.haleSessionsEntry.hidden = Boolean(window.breathingIndicator?.isActive);
            this.haleSessionsEntry.setAttribute('aria-expanded', 'false');
        }
        this.musicTab?.setActive(false);
        this.themesTab?.setActive(false);
        this.sessionsTab?.setActive(false);
        this.clearScrollPerformanceMode();

        // Notify Serenity Mode to restore quality
        if (this.serenityMode && typeof this.serenityMode.onHubClose === 'function') {
            this.serenityMode.onHubClose();
        }

        // Hide backdrop and panel
        this.backdrop.classList.remove('visible');
        this.panel.classList.remove('open');
        document.body.classList.remove('serenity-hub-open');

        // Update icon state
        this.hubIcon.classList.remove('active');
        this.hubIcon.setAttribute('aria-label', 'Open Serenity Hub');

        // Restore global settings button visibility
        if (this.settingsBtn) {
            this.settingsBtn.style.visibility = '';
            this.settingsBtn.style.pointerEvents = '';
        }

        // Resume game if callback is set (for single player, local MP, infinity mode).
        // Breathing keeps falling-block gameplay paused after the Hub closes; the guide or
        // the session flow releases it when it leaves the screen.
        if (resumeGameplay && this.onResumeCallback && !this.holdsGameplay()) {
            this.onResumeCallback();
        }

        // Restart auto-hide
        this.startAutoHide();

        window.dispatchEvent(new CustomEvent('serenityHubVisibilityChange', {
            detail: {
                visible: false,
                currentTab: this.currentTab,
            },
        }));

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
            closeHub: () => { if (!this.themesTab?.closeCollectionDetails?.()) this.hide(); },
            isHubOpen: () => this.isOpen,

            // Tab navigation (LB / RB)
            switchTabLeft: () => this.stepTab('ArrowLeft'),
            switchTabRight: () => this.stepTab('ArrowRight'),

            // Item navigation
            navigate: (direction) => this.handleNavigation(direction),
            confirmSelection: () => this.confirmItem(),

            // Hale sessions while the Hub is closed: the session screens first, then the guide.
            sessionPrimary: () => {
                if (this.sessionsTab?.flowOpen) this.sessionsTab.primaryAction();
                else window.breathingIndicator?.primaryAction?.();
            },
            sessionBack: () => {
                if (this.sessionsTab?.flowOpen) this.sessionsTab.back();
                else window.breathingIndicator?.backAction?.();
            },

            // Scrolling
            scrollContent: (delta) => {
                scrollHubScrollContainer(this.panel, delta);
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
            scrollHubElementIntoView(nextElement);
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
     * Show or hide the controls overlay (/ on a keyboard, Select on a pad). It lists the
     * player's own bindings as Keystone keycaps and steps away by itself after ten seconds.
     */
    toggleButtonHints() {
        const existing = document.getElementById('gamepad-hints-overlay');
        if (existing) {
            if (existing.classList.contains('visible')) {
                existing.classList.remove('visible');
                setTimeout(() => existing.remove(), 300);
            }
            return;
        }

        const settings = this.serenityMode.deps?.settingsManager?.get?.() || {};
        const pad = { ...DEFAULT_PAD_BINDINGS, ...(settings.serenityGamepadBindings || {}) };
        const keys = { ...DEFAULT_KEY_BINDINGS, ...(settings.serenityKeyBindings || {}) };
        const padName = (action) => escapeHtml(PAD_BUTTON_NAMES[pad[action]] || `Button ${pad[action]}`);
        const keyName = (action) => escapeHtml(formatKeyName(keys[action]));
        const status = this.serenityMode.deps?.gamepadController?.getConnectionStatus?.();
        const hasGamepad = Boolean(status?.controller1?.connected || status?.controller2?.connected);

        const play = hasGamepad ? [
            [[padName('toggleHub')], 'Open the hub'],
            [[padName('toggleBreathing')], 'Breathing guide'],
            [[padName('previousBreathingTechnique'), padName('nextBreathingTechnique')], 'Breathing world'],
            [[padName('randomTheme')], 'Random theme'],
            [[padName('toggleFullscreen')], 'Full screen'],
            [[padName('previousTrack'), padName('nextTrack')], 'Change track'],
            [[padName('volumeDown'), padName('volumeUp')], 'Music volume'],
            [[padName('openSettings')], 'Settings'],
        ] : [
            [[keyName('toggleHub')], 'Open the hub'],
            [[keyName('toggleBreathing')], 'Breathing guide'],
            [[keyName('cycleBreathingTechnique')], 'Next breathing world'],
            [[keyName('randomTheme')], 'Random theme'],
            [[keyName('toggleFullscreen')], 'Full screen'],
            [[keyName('exitToMenu')], 'Back to the menu'],
        ];
        const inHub = hasGamepad ? [
            [[padName('navigateLeft'), padName('navigateRight')], 'Move'],
            [[padName('confirmSelection')], 'Choose'],
            [[padName('previousTrack'), padName('nextTrack')], 'Switch tabs'],
            [['R-stick'], 'Scroll'],
            [[padName('closeHub')], 'Close the hub'],
        ] : [
            [['&larr;', '&rarr;'], 'Switch tabs'],
            [['Tab'], 'Move between controls'],
            [['Enter'], 'Choose'],
            [[keyName('toggleHub'), keyName('exitToMenu')], 'Close the hub'],
        ];
        const capsOf = (caps) => caps.map((cap) => `<kbd class="sb-kbd hint-button">${cap}</kbd>`).join('');
        const rows = (list) => list.map(([caps, label]) => `<li class="hint-item">
                <span class="hint-keys">${capsOf(caps)}</span><span class="hint-label">${label}</span></li>`).join('');
        const hideKey = hasGamepad ? padName('toggleControlHints') : keyName('toggleControlHints');

        const overlay = document.createElement('div');
        overlay.id = 'gamepad-hints-overlay';
        // .serenity-hub: a click on the overlay is not a click on the game (SerenityMode).
        overlay.className = 'gamepad-hints serenity-hub visible';
        overlay.setAttribute('role', 'region');
        overlay.setAttribute('aria-label', 'Serenity controls');
        overlay.innerHTML = `
            <header class="hint-head">
                <p class="sb-eyebrow">${hasGamepad ? 'Controller' : 'Keyboard'}</p>
                <h2 class="hint-heading">Serenity controls</h2>
            </header>
            <section class="hint-section">
                <h3 class="hint-title">While you play</h3>
                <ul class="hint-grid">${rows(play)}</ul>
            </section>
            <section class="hint-section">
                <h3 class="hint-title">With the hub open</h3>
                <ul class="hint-grid">${rows(inHub)}</ul>
            </section>
            <p class="hint-footer">Press <kbd class="sb-kbd">${hideKey}</kbd> again to hide</p>`;
        document.body.appendChild(overlay);

        // Steps away by itself after ten seconds.
        setTimeout(() => {
            if (!overlay.parentNode) return;
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 300);
        }, 10000);
    }

    /**
   * Destroy the hub and clean up
   */
    destroy() {
        console.log('[SerenityHub] Starting cleanup...');

        // Clear timers
        this.cancelAutoHide();
        this.clearScrollPerformanceMode();

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
            for (const [, controller] of this.tabAbortControllers.entries()) {
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
        this.haleSessionsEntry?.remove();
        this.haleSessionsEntry = null;
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
        document.body.classList.remove('serenity-hub-open');

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

        this.sessionsTab?.destroy();
        this.sessionsTab = null;
        this.sessionManager?.destroy?.();
        this.sessionManager = null;

        // Null out AbortController and references (Phase 6.1: Null Reference Cleanup)
        this.abortController = null;
        this.gamepadCallbacks = null;
        this.serenityMode = null;

        console.log('✅ [SerenityHub] Destroyed - all listeners removed via AbortController');
    }
}
