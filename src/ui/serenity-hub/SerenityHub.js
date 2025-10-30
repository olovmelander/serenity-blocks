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

export class SerenityHub {
  constructor(serenityMode) {
    this.serenityMode = serenityMode;
    this.isOpen = false;
    this.currentTab = 'breathing'; // 'breathing', 'music', 'themes'

    // DOM elements
    this.hubIcon = null;
    this.panel = null;
    this.backdrop = null;

    // Auto-hide behavior
    this.hideTimeout = null;
    this.hideDelay = 3000; // 3 seconds
    this.isMouseOverHub = false;

    // Tab instances
    this.breathingTab = null;
    this.musicTab = null;
    this.themesTab = null;

    // Gamepad support (uses global gamepadController from main app)
    this.gamepadCallbacks = null;

    this.init();
  }

  /**
   * Initialize the Serenity Hub
   */
  init() {
    this.createHubIcon();
    this.createPanel();
    this.attachEventListeners();
    this.setupAutoHide();

    // Setup gamepad controller integration
    this.setupGamepadIntegration();

    console.log('✨ Serenity Hub initialized with gamepad support');
  }

  /**
   * Create the floating hub icon (top-right corner)
   */
  createHubIcon() {
    this.hubIcon = document.createElement('div');
    this.hubIcon.id = 'serenity-hub-icon';
    this.hubIcon.className = 'serenity-hub-icon';
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

    // Add click handler
    this.hubIcon.addEventListener('click', () => this.toggle());

    // Add keyboard handler
    this.hubIcon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Mouse enter/leave for auto-hide prevention
    this.hubIcon.addEventListener('mouseenter', () => {
      this.isMouseOverHub = true;
      this.cancelAutoHide();
    });

    this.hubIcon.addEventListener('mouseleave', () => {
      this.isMouseOverHub = false;
      if (!this.isOpen) {
        this.startAutoHide();
      }
    });

    document.body.appendChild(this.hubIcon);
  }

  /**
   * Create the main panel with tabs
   */
  createPanel() {
    // Create backdrop
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'serenity-hub-backdrop';
    this.backdrop.addEventListener('click', () => this.hide());

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
                data-tab="breathing"
                role="tab"
                aria-selected="true"
                aria-controls="tab-breathing">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 6v12M6 12h12"></path>
          </svg>
          <span>Breathing</span>
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
                data-tab="themes"
                role="tab"
                aria-selected="false"
                aria-controls="tab-themes">
          <svg class="tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="4"></circle>
            <path d="M12 2v4m0 12v4M2 12h4m12 0h4"></path>
          </svg>
          <span>Themes</span>
        </button>
      </nav>

      <div class="hub-tab-content">
        <div id="tab-breathing" class="tab-panel active" role="tabpanel" aria-labelledby="tab-breathing">
          <div class="tab-loading">Loading breathing techniques...</div>
        </div>
        <div id="tab-music" class="tab-panel" role="tabpanel" aria-labelledby="tab-music">
          <div class="tab-loading">Loading music player...</div>
        </div>
        <div id="tab-themes" class="tab-panel" role="tabpanel" aria-labelledby="tab-themes">
          <div class="tab-loading">Loading themes...</div>
        </div>
      </div>
    `;

    // Add close button handler
    const closeBtn = this.panel.querySelector('.hub-close-btn');
    closeBtn.addEventListener('click', () => this.hide());

    // Prevent clicks inside panel from closing it
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    document.body.appendChild(this.backdrop);
    document.body.appendChild(this.panel);
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Tab switching
    const tabs = this.panel.querySelectorAll('.hub-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });

      // Keyboard navigation for tabs
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const tabName = tab.dataset.tab;
          this.switchTab(tabName);
        }
      });
    });

    // ESC key to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.hide();
      }
    });

    // Mouse over panel prevents auto-hide
    this.panel.addEventListener('mouseenter', () => {
      this.isMouseOverHub = true;
      this.cancelAutoHide();
    });

    this.panel.addEventListener('mouseleave', () => {
      this.isMouseOverHub = false;
    });
  }

  /**
   * Setup auto-hide behavior for the hub icon
   */
  setupAutoHide() {
    let mouseMoveTimeout = null;

    document.addEventListener('mousemove', () => {
      // Show icon on mouse movement
      this.showIcon();

      // Reset hide timeout
      clearTimeout(mouseMoveTimeout);

      if (!this.isOpen && !this.isMouseOverHub) {
        mouseMoveTimeout = setTimeout(() => {
          this.startAutoHide();
        }, this.hideDelay);
      }
    });

    // Initially hide after delay
    this.startAutoHide();
  }

  /**
   * Show the hub icon
   */
  showIcon() {
    this.hubIcon.classList.add('visible');
    this.cancelAutoHide();
  }

  /**
   * Start auto-hide timer for icon
   */
  startAutoHide() {
    this.cancelAutoHide();

    if (!this.isOpen && !this.isMouseOverHub) {
      this.hideTimeout = setTimeout(() => {
        this.hubIcon.classList.remove('visible');
      }, this.hideDelay);
    }
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
    tabs.forEach(tab => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive);
    });

    // Update tab panels
    const panels = this.panel.querySelectorAll('.tab-panel');
    panels.forEach(panel => {
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
  }

  /**
   * Show the hub panel
   */
  show() {
    if (this.isOpen) return;

    this.isOpen = true;

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
        const tabs = ['breathing', 'music', 'themes'];
        const currentIndex = tabs.indexOf(this.currentTab);
        const newIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        this.switchTab(tabs[newIndex]);
      },
      switchTabRight: () => {
        const tabs = ['breathing', 'music', 'themes'];
        const currentIndex = tabs.indexOf(this.currentTab);
        const newIndex = (currentIndex + 1) % tabs.length;
        this.switchTab(tabs[newIndex]);
      },
      
      // Item navigation
      navigateUp: () => this.navigateItems(-1),
      navigateDown: () => this.navigateItems(1),
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
      toggleHints: () => this.toggleButtonHints()
      
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
   * Navigate items in current tab
   */
  navigateItems(direction) {
    const items = this.getNavigableItems();
    if (items.length === 0) return;

    // Find currently focused item or start at 0
    const currentIndex = items.findIndex(item => item.classList.contains('gamepad-focused'));
    let newIndex = currentIndex === -1 ? 0 : currentIndex + direction;
    
    // Wrap around
    if (newIndex < 0) newIndex = items.length - 1;
    if (newIndex >= items.length) newIndex = 0;

    // Update focus
    items.forEach((item, idx) => {
      if (idx === newIndex) {
        item.classList.add('gamepad-focused');
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        item.classList.remove('gamepad-focused');
      }
    });
  }

  /**
   * Get navigable items in current tab
   */
  getNavigableItems() {
    const currentTab = this.currentTab;

    if (currentTab === 'breathing') {
      return Array.from(this.panel.querySelectorAll('.technique-card'));
    } else if (currentTab === 'music') {
      return Array.from(this.panel.querySelectorAll('.playlist-item'));
    } else if (currentTab === 'themes') {
      return Array.from(this.panel.querySelectorAll('.theme-card'));
    }

    return [];
  }

  /**
   * Confirm focused item
   */
  confirmItem() {
    const focusedItem = this.panel.querySelector('.gamepad-focused');
    if (focusedItem) {
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
            <div class="hint-item"><span class="hint-button">L-Stick</span> Navigate</div>
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
    // Clear timers
    this.cancelAutoHide();

    // Disable gamepad integration
    const gamepadController = this.serenityMode.deps?.gamepadController;
    if (gamepadController) {
      gamepadController.disableSerenityMode();
      console.log('[SerenityHub] Gamepad integration disabled');
    }

    // Remove event listeners
    document.removeEventListener('mousemove', this.setupAutoHide);

    // Remove DOM elements
    if (this.hubIcon) {
      this.hubIcon.remove();
    }
    if (this.panel) {
      this.panel.remove();
    }
    if (this.backdrop) {
      this.backdrop.remove();
    }

    // Clean up tab instances
    if (this.breathingTab) {
      this.breathingTab.destroy?.();
    }
    if (this.musicTab) {
      this.musicTab.destroy?.();
    }
    if (this.themesTab) {
      this.themesTab.destroy?.();
    }

    console.log('Serenity Hub destroyed');
  }
}
