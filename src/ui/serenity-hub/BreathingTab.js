/**
 * BreathingTab - Breathing techniques control panel
 *
 * Provides visual interface for:
 * - 7 breathing techniques with unique cards
 * - Toggle breathing guide on/off
 * - Technique information display
 * - Settings (text prompts, auto-start)
 */

export class BreathingTab {
  constructor(hubInstance, breathingIndicator) {
    this.hub = hubInstance;
    this.breathingIndicator = breathingIndicator;
    this.serenityMode = hubInstance.serenityMode;

    // Get techniques from EnhancedBreathingIndicator
    this.techniques = this.getTechniques();

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
    const techniques = Object.keys(this.breathingIndicator.techniques).map(id => {
      const tech = this.breathingIndicator.techniques[id];
      return {
        id: id,
        name: tech.name,
        pattern: tech.pattern,
        description: tech.description,
        color: tech.color,
        // Create emoji based on technique type
        emoji: this.getTechniqueEmoji(id)
      };
    });

    return techniques;
  }

  /**
   * Get emoji for each technique
   */
  getTechniqueEmoji(id) {
    const emojiMap = {
      'deep-relaxation': '🌊',
      'box-breathing': '⬜',
      'calm-sleep': '🌙',
      'energizing': '⚡',
      'coherence': '💚',
      'triangle': '🔺',
      'wim-hof': '🔥'
    };
    return emojiMap[id] || '🧘';
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

  /**
   * Render the breathing tab
   */
  render() {
    const container = document.getElementById('tab-breathing');
    if (!container) {
      console.error('[BreathingTab] Container not found');
      return;
    }

    // Clear loading message
    container.innerHTML = '';

    // Create main content
    const content = document.createElement('div');
    content.className = 'breathing-tab-content';

    // Toggle switch section
    const toggleSection = this.createToggleSection();

    // Techniques grid
    const techniqueGrid = this.createTechniqueGrid();

    // Info display
    const infoDisplay = this.createInfoDisplay();

    // Settings section
    const settingsSection = this.createSettingsSection();

    content.appendChild(toggleSection);
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
    section.className = 'breathing-toggle-section';

    const isActive = this.serenityMode.breathingIndicatorActive;

    section.innerHTML = `
      <div class="breathing-toggle-header">
        <h3 class="section-title">Breathing Guide</h3>
        <label class="toggle-switch">
          <input type="checkbox" id="breathing-guide-toggle" ${isActive ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
      </div>
      <p class="section-description">
        ${isActive ? '✓ Active' : 'Start the breathing guide to begin your practice'}
      </p>
    `;

    return section;
  }

  /**
   * Create technique cards grid
   */
  createTechniqueGrid() {
    const section = document.createElement('div');
    section.className = 'technique-section';

    const title = document.createElement('h3');
    title.className = 'section-title';
    title.textContent = 'Choose Your Technique';

    const grid = document.createElement('div');
    grid.className = 'technique-grid';
    grid.id = 'breathing-technique-grid';

    // Create card for each technique
    this.techniques.forEach(technique => {
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
    const card = document.createElement('div');
    card.className = 'technique-card';
    card.dataset.techniqueId = technique.id;

    // Check if this is the current technique
    const isActive = this.breathingIndicator.currentTechnique === technique.id;
    if (isActive) {
      card.classList.add('active');
    }

    // Get RGB color
    const { r, g, b } = technique.color;
    const colorStyle = `rgb(${r}, ${g}, ${b})`;

    card.innerHTML = `
      <div class="technique-icon" style="background: linear-gradient(135deg, ${colorStyle}, rgba(${r}, ${g}, ${b}, 0.6));">
        <span class="technique-emoji">${technique.emoji}</span>
      </div>
      <div class="technique-info">
        <div class="technique-name">${technique.name}</div>
        <div class="technique-pattern-mini">${technique.pattern.join('-')}</div>
      </div>
      ${isActive ? '<div class="active-indicator">●</div>' : ''}
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

    // Get current technique
    const currentTech = this.techniques.find(
      t => t.id === this.breathingIndicator.currentTechnique
    ) || this.techniques[0];

    section.innerHTML = `
      <div class="info-header">
        <span class="info-emoji">${currentTech.emoji}</span>
        <h4 class="info-title">${currentTech.name}</h4>
      </div>
      <p class="info-description">${currentTech.description}</p>
      <div class="info-pattern">
        <strong>Pattern:</strong> ${this.formatPattern(currentTech.pattern)}
      </div>
    `;

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
    // Toggle breathing guide
    const toggle = document.getElementById('breathing-guide-toggle');
    if (toggle) {
      toggle.addEventListener('change', (e) => {
        this.toggleBreathingGuide(e.target.checked);
      });
    }

    // Technique card clicks
    const grid = document.getElementById('breathing-technique-grid');
    if (grid) {
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.technique-card');
        if (card) {
          const techniqueId = card.dataset.techniqueId;
          this.selectTechnique(techniqueId);
        }
      });
    }

    // Text prompts toggle
    const textToggle = document.getElementById('breathing-text-toggle');
    if (textToggle) {
      textToggle.addEventListener('change', (e) => {
        this.updateSetting('breathingText', e.target.checked);
      });
    }

    // Auto-start toggle
    const autoStartToggle = document.getElementById('breathing-auto-start');
    if (autoStartToggle) {
      autoStartToggle.addEventListener('change', (e) => {
        this.updateSetting('breathingGuideAutoStart', e.target.checked);
      });
    }
  }

  /**
   * Toggle breathing guide on/off
   */
  toggleBreathingGuide(enabled) {
    if (enabled) {
      this.serenityMode._showBreathingIndicator();
    } else {
      this.serenityMode._hideBreathingIndicator();
    }

    // Update UI
    this.updateToggleUI(enabled);
  }

  /**
   * Update toggle UI state
   */
  updateToggleUI(enabled) {
    const description = document.querySelector('.breathing-toggle-section .section-description');
    if (description) {
      description.textContent = enabled
        ? '✓ Active - Follow the breathing rhythm'
        : 'Start the breathing guide to begin your practice';
    }
  }

  /**
   * Select a breathing technique
   */
  selectTechnique(techniqueId) {
    // Update breathing indicator
    if (this.breathingIndicator) {
      this.breathingIndicator.setTechnique(techniqueId);
    }

    // Save to settings
    this.serenityMode.deps.settingsManager.update({
      breathingTechnique: techniqueId
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
    const cards = document.querySelectorAll('.technique-card');
    cards.forEach(card => {
      card.classList.remove('active');
      const indicator = card.querySelector('.active-indicator');
      if (indicator) indicator.remove();
    });

    // Add active class to selected card
    const activeCard = document.querySelector(`[data-technique-id="${techniqueId}"]`);
    if (activeCard) {
      activeCard.classList.add('active');
      const indicator = document.createElement('div');
      indicator.className = 'active-indicator';
      indicator.textContent = '●';
      activeCard.appendChild(indicator);
    }
  }

  /**
   * Update info display
   */
  updateInfoDisplay(techniqueId) {
    const technique = this.techniques.find(t => t.id === techniqueId);
    if (!technique) return;

    const infoDisplay = document.getElementById('breathing-info-display');
    if (!infoDisplay) return;

    infoDisplay.innerHTML = `
      <div class="info-header">
        <span class="info-emoji">${technique.emoji}</span>
        <h4 class="info-title">${technique.name}</h4>
      </div>
      <p class="info-description">${technique.description}</p>
      <div class="info-pattern">
        <strong>Pattern:</strong> ${this.formatPattern(technique.pattern)}
      </div>
    `;

    // Animate the update
    infoDisplay.style.animation = 'none';
    setTimeout(() => {
      infoDisplay.style.animation = 'tab-content-fade 0.3s ease';
    }, 10);
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
    // Remove event listeners (handled by DOM removal)
    console.log('[BreathingTab] Destroyed');
  }
}
