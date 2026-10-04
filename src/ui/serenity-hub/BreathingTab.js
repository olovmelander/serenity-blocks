/**
 * BreathingTab - Breathing techniques control panel
 *
 * Provides visual interface for:
 * - 12 illustrated breathing worlds with clear rhythm counts
 * - Toggle breathing guide on/off
 * - Technique information display
 * - Settings (text prompts, auto-start)
 */

import { csIcon } from '../components/cosmic-icons.js';

const EXPERIENCE_DETAILS = {
    'deep-relaxation': {
        atmosphere: 'Northern light',
        description: 'Silken aurora curtains gather over a quiet horizon, opening with each inhale.',
    },
    'box-breathing': {
        atmosphere: 'Luminous symmetry',
        description: 'Golden geometry and violet light trace a balanced rhythm through four equal phases.',
    },
    'calm-sleep': {
        atmosphere: 'Silver stillness',
        description: 'A silver moon floats above shimmering water, with a long, unhurried release.',
    },
    energizing: {
        atmosphere: 'Radiant warmth',
        description: 'A glowing sun unfurls its corona in amber, gold, and soft orange light.',
    },
    coherence: {
        atmosphere: 'Rose radiance',
        description: 'Rose light expands and returns in an even rhythm, surrounded by delicate luminous trails.',
    },
    triangle: {
        atmosphere: 'Prismatic light',
        description: 'A suspended crystal bends cyan, pink, and gold into a three-part rhythm.',
    },
    'wim-hof': {
        atmosphere: 'Ember current',
        description: 'Warm embers rise from a molten landscape, following the shortest rhythm in the collection.',
    },
    'ocean-breath': {
        atmosphere: 'Tidal flow',
        description: 'Layers of turquoise water swell and recede, carrying an uninterrupted inhale and exhale.',
    },
    'zen-garden': {
        atmosphere: 'Quiet ripples',
        description: 'Soft sand contours, smooth stones, and drifting petals frame a spacious, measured cycle.',
    },
    'cosmic-breath': {
        atmosphere: 'Celestial drift',
        description: 'Violet nebula ribbons and distant stars spiral around a glowing celestial centre.',
    },
    'forest-breath': {
        atmosphere: 'Emerald sanctuary',
        description: 'A layered forest opens into emerald light, with fireflies moving between the trees.',
    },
    'electric-storm': {
        atmosphere: 'Blue atmosphere',
        description: 'Electric-blue clouds, violet currents, and fine rain surround a shifting rhythm.',
    },
};

export class BreathingTab {
    constructor(hubInstance, breathingIndicator) {
        this.hub = hubInstance;
        this.breathingIndicator = breathingIndicator;
        this.serenityMode = hubInstance.serenityMode;

        // Get techniques from EnhancedBreathingIndicator
        this.techniques = this.getTechniques();

        // Store event handler references for cleanup
        this.toggleHandler = null;
        this.gridClickHandler = null;
        this.textToggleHandler = null;
        this.autoStartToggleHandler = null;
        this.interactionKeydownHandler = null;
        this.sessionButtonHandler = null;
        this.container = null;

        this.init();
    }

    init() {
        this.render();
        this.attachEventListeners();
        console.log('[BreathingTab] Initialized with', this.techniques.length, 'techniques');
    }

    /**
   * Get breathing techniques from the breathing indicator
   */
    getTechniques() {
        if (!this.breathingIndicator || !this.breathingIndicator.techniques) {
            console.warn('[BreathingTab] No breathing indicator techniques found');
            return [];
        }

        // Convert techniques object to array with metadata
        const techniques = Object.keys(this.breathingIndicator.techniques).map((id) => {
            const tech = this.breathingIndicator.techniques[id];
            const experience = EXPERIENCE_DETAILS[id] || {};
            return {
                id,
                name: tech.name,
                pattern: tech.pattern,
                description: experience.description || tech.description,
                atmosphere: experience.atmosphere || 'Living light',
                color: tech.color,
                secondaryColor: tech.secondaryColor || tech.color,
                tertiaryColor: tech.tertiaryColor || tech.color,
                // Create emoji based on technique type
                emoji: this.getTechniqueEmoji(id),
            };
        });

        return techniques;
    }

    /**
   * Get a custom line-SVG icon for each technique (no emojis).
   */
    getTechniqueEmoji(id) {
        const iconMap = {
            'deep-relaxation': 'aurora-dreams',
            'box-breathing': 'sacred-geometry',
            'calm-sleep': 'moonlit-waters',
            energizing: 'solar-flare',
            coherence: 'heart-glow',
            triangle: 'crystal-prism',
            'wim-hof': 'volcanic-fire',
            'ocean-breath': 'ocean-tide',
            'zen-garden': 'zen-garden',
            'cosmic-breath': 'cosmic-nebula',
            'forest-breath': 'ancient-forest',
            'electric-storm': 'electric-storm',
        };
        return csIcon(iconMap[id] || 'breath', 30);
    }

    /**
   * Format breathing pattern for display
   */
    formatPattern(pattern) {
        const [inhale, hold1, exhale, hold2] = pattern;
        let formatted = `Inhale ${inhale}s`;

        if (hold1 > 0) formatted += ` → Hold ${hold1}s`;
        formatted += ` → Exhale ${exhale}s`;
        if (hold2 > 0) formatted += ` → Hold ${hold2}s`;

        return formatted;
    }

    renderRhythm(pattern) {
        const labels = ['In', 'Hold', 'Out', 'Rest'];
        return pattern.map((count, index) => (count > 0 ? `
            <span class="breath-rhythm-step" data-phase="${index}">
                <span class="breath-rhythm-label">${labels[index]}</span>
                <span class="breath-rhythm-count">${count}<small>s</small></span>
            </span>
        ` : '')).join('');
    }

    applyPalette(node, technique) {
        const rgb = (color) => `${color.r}, ${color.g}, ${color.b}`;
        node.style.setProperty('--experience-rgb', rgb(technique.color));
        node.style.setProperty('--experience-primary', `rgb(${rgb(technique.color)})`);
        node.style.setProperty('--experience-secondary', `rgb(${rgb(technique.secondaryColor)})`);
        node.style.setProperty('--experience-tertiary', `rgb(${rgb(technique.tertiaryColor)})`);
    }

    /**
   * Render the breathing tab
   */
    render() {
        const container = document.getElementById('tab-breathing');
        if (!container) {
            console.error('[BreathingTab] Container not found');
            return;
        }
        this.container = container;

        // Clear loading message
        container.innerHTML = '';

        // Create main content
        const content = document.createElement('div');
        content.className = 'breathing-tab-content';

        // Toggle switch section
        const toggleSection = this.createToggleSection();
        const sessionNotice = this.createGuidedSessionNotice();

        // Techniques grid
        const techniqueGrid = this.createTechniqueGrid();

        // Info display
        const infoDisplay = this.createInfoDisplay();

        // Settings section
        const settingsSection = this.createSettingsSection();

        content.appendChild(toggleSection);
        content.appendChild(sessionNotice);
        content.appendChild(techniqueGrid);
        content.appendChild(infoDisplay);
        content.appendChild(settingsSection);

        container.appendChild(content);
    }

    /**
   * Create toggle switch for breathing guide
   */
    createToggleSection() {
        const section = document.createElement('div');
        section.className = 'breathing-toggle-section breath-library-intro';

        const isActive = this.serenityMode.breathingIndicatorActive;
        const isGuided = this.breathingIndicator.isExternallyControlled;
        const statusText = isActive ? 'Guide is on · Follow the light at your own pace'
            : 'Choose a world, then turn on the guide to follow its light.';

        section.innerHTML = `
      <div class="breathing-toggle-header">
        <div>
          <span class="breath-library-eyebrow">Twelve living worlds</span>
          <h3 class="section-title">Find your rhythm</h3>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" id="breathing-guide-toggle" aria-label="Show breathing guide"
            ${isActive ? 'checked' : ''} ${isGuided ? 'disabled' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="section-description">
        ${statusText}
      </p>
    `;

        return section;
    }

    createGuidedSessionNotice() {
        const notice = document.createElement('div');
        notice.className = 'breath-guided-session-notice';
        notice.hidden = !this.breathingIndicator.isExternallyControlled;
        notice.innerHTML = `
            <div>
                <span class="breath-library-eyebrow">Guided session in progress</span>
                <p>Your session controls the rhythm. Return to Sessions to review or end it.</p>
            </div>
            <button type="button" class="breath-open-sessions">Open Sessions</button>
        `;
        return notice;
    }

    /**
   * Create technique cards grid
   */
    createTechniqueGrid() {
        const section = document.createElement('div');
        section.className = 'technique-section';

        const title = document.createElement('h3');
        title.className = 'section-title';
        title.textContent = 'Choose your atmosphere';

        const grid = document.createElement('div');
        grid.className = 'technique-grid';
        grid.id = 'breathing-technique-grid';
        grid.setAttribute('aria-label', 'Breathing worlds');

        // Create card for each technique
        this.techniques.forEach((technique) => {
            const card = this.createTechniqueCard(technique);
            grid.appendChild(card);
        });

        section.appendChild(title);
        section.appendChild(grid);

        return section;
    }

    /**
   * Create individual technique card
   */
    createTechniqueCard(technique) {
        const card = document.createElement('button');
        card.type = 'button';
        card.disabled = Boolean(this.breathingIndicator.isExternallyControlled);
        card.className = 'technique-card breath-experience-card';
        card.dataset.techniqueId = technique.id;

        // Check if this is the current technique
        const isActive = this.breathingIndicator.currentTechnique === technique.id;
        if (isActive) {
            card.classList.add('active');
        }
        card.setAttribute('aria-pressed', String(isActive));
        card.setAttribute('aria-label', `${technique.name}. ${this.formatPattern(technique.pattern)}.`);
        this.applyPalette(card, technique);

        card.innerHTML = `
      <span class="breath-art" data-world="${technique.id}" aria-hidden="true">
        <span class="breath-art-orb"></span>
        <span class="breath-art-line"></span>
        <span class="breath-art-particles"></span>
      </span>
      <span class="breath-card-selection" aria-hidden="true">${csIcon('check', 12)}<span>Selected</span></span>
      <span class="technique-info">
        <span class="technique-name">${technique.name}</span>
        <span class="breath-card-atmosphere">${technique.atmosphere}</span>
      </span>
      <span class="breath-rhythm" aria-hidden="true">${this.renderRhythm(technique.pattern)}</span>
    `;

        return card;
    }

    /**
   * Create info display section
   */
    createInfoDisplay() {
        const section = document.createElement('div');
        section.className = 'technique-info-display';
        section.id = 'breathing-info-display';
        section.setAttribute('aria-live', 'polite');

        // Get current technique
        const currentTech = this.techniques.find(
            (t) => t.id === this.breathingIndicator.currentTechnique,
        ) || this.techniques[0];

        if (currentTech) this.renderInfoDisplay(section, currentTech);

        return section;
    }

    /**
   * Create settings section
   */
    createSettingsSection() {
        const section = document.createElement('div');
        section.className = 'breathing-settings-section';

        const settings = this.serenityMode.deps.settingsManager.get();

        section.innerHTML = `
      <h3 class="section-title">Settings</h3>
      <div class="setting-item">
        <label class="setting-label">
          <input type="checkbox" id="breathing-text-toggle" ${settings.breathingText !== false ? 'checked' : ''}>
          <span>Show text prompts</span>
        </label>
        <p class="setting-description">Display "Breathe In", "Hold", "Breathe Out" text</p>
      </div>
      <div class="setting-item">
        <label class="setting-label">
          <input type="checkbox" id="breathing-auto-start" ${settings.breathingGuideAutoStart ? 'checked' : ''}>
          <span>Auto-start on mode entry</span>
        </label>
        <p class="setting-description">Automatically start breathing guide when entering Serenity Mode</p>
      </div>
    `;

        return section;
    }

    /**
   * Attach event listeners
   */
    attachEventListeners() {
        // Keep native button/checkbox activation from also toggling the global guide shortcut.
        this.interactionKeydownHandler = (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            const control = event.target.closest('button, input');
            if (control && this.container.contains(control)) event.stopPropagation();
        };
        this.container?.addEventListener('keydown', this.interactionKeydownHandler);
        this.sessionButtonHandler = () => this.hub.switchTab('sessions');
        this.container?.querySelector('.breath-open-sessions')?.addEventListener('click', this.sessionButtonHandler);

        // Store handler references for cleanup
        this.toggleHandler = (e) => {
            this.toggleBreathingGuide(e.target.checked);
        };

        this.gridClickHandler = (e) => {
            const card = e.target.closest('.technique-card');
            if (card && this.container.contains(card)) {
                const { techniqueId } = card.dataset;
                this.selectTechnique(techniqueId);
            }
        };

        this.textToggleHandler = (e) => {
            this.updateSetting('breathingText', e.target.checked);
        };

        this.autoStartToggleHandler = (e) => {
            this.updateSetting('breathingGuideAutoStart', e.target.checked);
        };

        // Toggle breathing guide
        const toggle = document.getElementById('breathing-guide-toggle');
        if (toggle) {
            toggle.addEventListener('change', this.toggleHandler);
        }

        // Technique card clicks
        const grid = document.getElementById('breathing-technique-grid');
        if (grid) {
            grid.addEventListener('click', this.gridClickHandler);
        }

        // Text prompts toggle
        const textToggle = document.getElementById('breathing-text-toggle');
        if (textToggle) {
            textToggle.addEventListener('change', this.textToggleHandler);
        }

        // Auto-start toggle
        const autoStartToggle = document.getElementById('breathing-auto-start');
        if (autoStartToggle) {
            autoStartToggle.addEventListener('change', this.autoStartToggleHandler);
        }
    }

    /**
   * Toggle breathing guide on/off
   */
    toggleBreathingGuide(enabled) {
        if (this.breathingIndicator.isExternallyControlled) return;
        const modeHandler = enabled ? this.serenityMode._showBreathingIndicator
            : this.serenityMode._hideBreathingIndicator;
        if (typeof modeHandler === 'function') {
            modeHandler.call(this.serenityMode);
        } else if (enabled) {
            this.breathingIndicator.start();
        } else {
            this.breathingIndicator.stop();
        }

        const active = Boolean(this.breathingIndicator.isActive);
        this.serenityMode.breathingIndicatorActive = active;
        this.refresh();
        this.serenityMode.deps.settingsManager.update({ breathingGuideEnabled: active });
    }

    /**
   * Update toggle UI state
   */
    updateToggleUI(enabled) {
        const description = this.container?.querySelector('.breathing-toggle-section .section-description');
        if (description) {
            if (enabled) {
                description.textContent = 'Guide is on · Follow the light at your own pace';
            } else {
                description.textContent = 'Choose a world, then turn on the guide to follow its light.';
            }
        }
    }

    /**
   * Select a breathing technique
   */
    selectTechnique(techniqueId) {
        if (this.breathingIndicator.isExternallyControlled) return;
        if (!this.techniques.some((technique) => technique.id === techniqueId)) return;
        // Update breathing indicator
        if (this.breathingIndicator) {
            this.breathingIndicator.setTechnique(techniqueId);
        }

        // Save to settings
        this.serenityMode.deps.settingsManager.update({
            breathingTechnique: techniqueId,
        });

        // Update UI
        this.updateActiveCard(techniqueId);
        this.updateInfoDisplay(techniqueId);

        console.log('[BreathingTab] Selected technique:', techniqueId);
    }

    /**
   * Update active card styling
   */
    updateActiveCard(techniqueId) {
        // Remove active class from all cards
        const cards = this.container?.querySelectorAll('.technique-card') || [];
        cards.forEach((card) => {
            const isActive = card.dataset.techniqueId === techniqueId;
            card.classList.toggle('active', isActive);
            card.setAttribute('aria-pressed', String(isActive));
        });
    }

    /**
   * Update info display
   */
    updateInfoDisplay(techniqueId) {
        const technique = this.techniques.find((t) => t.id === techniqueId);
        if (!technique) return;

        const infoDisplay = this.container?.querySelector('#breathing-info-display');
        if (!infoDisplay) return;
        this.renderInfoDisplay(infoDisplay, technique);
    }

    renderInfoDisplay(infoDisplay, technique) {
        this.applyPalette(infoDisplay, technique);
        const cycleSeconds = technique.pattern.reduce((total, count) => total + count, 0);
        infoDisplay.innerHTML = `
      <div class="info-header">
        <span class="info-emoji" aria-hidden="true">${technique.emoji}</span>
        <div>
          <span class="breath-library-eyebrow">Your selected world</span>
          <h4 class="info-title">${technique.name}</h4>
        </div>
        <span class="breath-cycle-duration">${cycleSeconds}s<span>per cycle</span></span>
      </div>
      <p class="info-description">${technique.description}</p>
      <div class="breath-rhythm breath-rhythm-detail" aria-label="${this.formatPattern(technique.pattern)}">
        ${this.renderRhythm(technique.pattern)}
      </div>
    `;
    }

    refresh() {
        if (!this.breathingIndicator || !this.container) return;
        this.updateSessionLock();
        const techniqueId = this.breathingIndicator.currentTechnique;
        this.updateActiveCard(techniqueId);
        this.updateInfoDisplay(techniqueId);
        const toggle = this.container.querySelector('#breathing-guide-toggle');
        const enabled = this.breathingIndicator.isActive;
        if (toggle) toggle.checked = enabled;
        this.updateToggleUI(enabled);
    }

    updateSessionLock() {
        const controlled = Boolean(this.breathingIndicator.isExternallyControlled);
        const notice = this.container?.querySelector('.breath-guided-session-notice');
        if (notice) notice.hidden = !controlled;
        const toggle = this.container?.querySelector('#breathing-guide-toggle');
        if (toggle) toggle.disabled = controlled;
        this.container?.querySelectorAll('.technique-card').forEach((card) => { card.disabled = controlled; });
    }

    /**
   * Update a setting
   */
    updateSetting(key, value) {
        this.serenityMode.deps.settingsManager.update({ [key]: value });

        // Apply the setting immediately if breathing is active
        if (key === 'breathingText' && this.breathingIndicator) {
            this.breathingIndicator.setShowText(value);
        }

        console.log('[BreathingTab] Updated setting:', key, '=', value);
    }

    /**
   * Cleanup
   */
    destroy() {
        this.container?.removeEventListener('keydown', this.interactionKeydownHandler);
        this.container?.querySelector('.breath-open-sessions')
            ?.removeEventListener('click', this.sessionButtonHandler);
        // Remove event listeners explicitly
        const toggle = document.getElementById('breathing-guide-toggle');
        if (toggle && this.toggleHandler) {
            toggle.removeEventListener('change', this.toggleHandler);
        }

        const grid = document.getElementById('breathing-technique-grid');
        if (grid && this.gridClickHandler) {
            grid.removeEventListener('click', this.gridClickHandler);
        }

        const textToggle = document.getElementById('breathing-text-toggle');
        if (textToggle && this.textToggleHandler) {
            textToggle.removeEventListener('change', this.textToggleHandler);
        }

        const autoStartToggle = document.getElementById('breathing-auto-start');
        if (autoStartToggle && this.autoStartToggleHandler) {
            autoStartToggle.removeEventListener('change', this.autoStartToggleHandler);
        }

        // Null out references
        this.toggleHandler = null;
        this.gridClickHandler = null;
        this.textToggleHandler = null;
        this.autoStartToggleHandler = null;
        this.interactionKeydownHandler = null;
        this.sessionButtonHandler = null;
        this.hub = null;
        this.breathingIndicator = null;
        this.serenityMode = null;
        this.techniques = null;
        this.container = null;

        console.log('✅ [BreathingTab] Destroyed - all listeners removed');
    }
}
