/**
 * Local Match Configuration Modal
 *
 * UI for configuring local multiplayer matches (2-4 players)
 * Similar to MatchConfigModal but for local multiplayer
 */

export class LocalMatchConfigModal {
    constructor(onStartMatch, onCancel = null) {
        this.onStartMatch = onStartMatch;
        this.onCancel = onCancel;
        this.container = null;

        this.createUI();
    }

    /**
   * Create the match config UI
   */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'local-match-config-modal';
        this.container.className = 'match-config-modal hidden';

        this.container.innerHTML = `
      <div class="match-config-overlay"></div>
      <div class="match-config-content">
        <div class="match-config-header">
          <h2>🎮 Local Multiplayer Setup</h2>
          <button class="close-btn" id="close-local-match-config">✕</button>
        </div>
        
        <form id="local-match-config-form" class="match-config-form">
          <!-- Number of Players -->
          <div class="form-group">
            <label for="num-players">Number of Players</label>
            <select id="num-players" name="numPlayers">
              <option value="2" selected>2 Players</option>
              <option value="3">3 Players</option>
              <option value="4">4 Players</option>
            </select>
            <small class="form-help">Local players on same computer</small>
          </div>
          
          <!-- Win Condition -->
          <div class="form-group">
            <label for="end-condition">Win Condition</label>
            <select id="end-condition" name="endCondition">
              <option value="frags" selected>Frags (Kills)</option>
              <option value="time">Time Limit</option>
              <option value="points">Score Target</option>
              <option value="lines">Lines Cleared</option>
              <option value="never">Never (Play Forever)</option>
            </select>
          </div>
          
          <!-- Win Condition Value -->
          <div class="form-group" id="end-value-group">
            <label for="end-condition-value" id="end-value-label">Frags to Win</label>
            <input 
              type="number" 
              id="end-condition-value" 
              name="endConditionValue"
              min="1"
              max="999"
              value="7"
              placeholder="7"
            />
            <small class="form-help" id="end-value-help">First player to reach 7 frags wins</small>
          </div>
          
          <!-- Advanced Settings -->
          <details class="advanced-settings">
            <summary>⚙️ Advanced Settings</summary>
            
            <div class="form-group">
              <label for="start-level">Starting Level (1-9)</label>
              <input 
                type="number" 
                id="start-level" 
                name="startLevel"
                min="1"
                max="9"
                value="1"
                placeholder="1"
              />
              <small class="form-help">Higher level = faster pieces</small>
            </div>
            
            <div class="form-group">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  id="level-progression" 
                  name="levelProgression"
                />
                <span>Enable Level Progression</span>
              </label>
              <small class="form-help">Level increases every 15 lines cleared</small>
            </div>
            
            <div class="form-group">
              <label class="checkbox-label">
                <input 
                  type="checkbox" 
                  id="boring-rules" 
                  name="boringRules"
                />
                <span>Boring Rules (No Attack Scaling)</span>
              </label>
              <small class="form-help">Attacks always deal full damage (no reduction for 3-4 players)</small>
            </div>
          </details>
          
          <!-- Action Buttons -->
          <div class="form-actions">
            <button type="button" class="btn-secondary" id="cancel-local-match">
              Cancel
            </button>
            <button type="submit" class="btn-primary">
              🚀 Start Match
            </button>
          </div>
        </form>
      </div>
    `;

        document.body.appendChild(this.container);
        this.setupEventListeners();
    }

    /**
   * Setup event listeners
   */
    setupEventListeners() {
    // Close button
        const closeBtn = this.container.querySelector('#close-local-match-config');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.cancel());
        }

        // Cancel button
        const cancelBtn = this.container.querySelector('#cancel-local-match');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.cancel());
        }

        // Overlay click to close
        const overlay = this.container.querySelector('.match-config-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.cancel());
        }

        // End condition change handler
        const endCondition = this.container.querySelector('#end-condition');
        if (endCondition) {
            endCondition.addEventListener('change', (e) => {
                this.updateEndConditionUI(e.target.value);
            });
        }

        // Form submit
        const form = this.container.querySelector('#local-match-config-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleSubmit();
            });
        }
    }

    /**
   * Update end condition UI based on selection
   */
    updateEndConditionUI(condition) {
        const valueGroup = this.container.querySelector('#end-value-group');
        const valueLabel = this.container.querySelector('#end-value-label');
        const valueInput = this.container.querySelector('#end-condition-value');
        const valueHelp = this.container.querySelector('#end-value-help');

        if (!valueGroup || !valueLabel || !valueInput || !valueHelp) {
            return;
        }

        const configs = {
            frags: {
                label: 'Frags to Win',
                defaultValue: 7,
                help: 'First player to reach this many frags wins',
                min: 1,
                max: 100,
                placeholder: '7',
            },
            time: {
                label: 'Time Limit (minutes)',
                defaultValue: 3,
                help: 'Player with highest score after this time wins',
                min: 1,
                max: 60,
                placeholder: '3',
            },
            points: {
                label: 'Score Target (thousands)',
                defaultValue: 10,
                help: 'First player to reach this score wins (e.g., 10 = 10,000 points)',
                min: 1,
                max: 999,
                placeholder: '10',
            },
            lines: {
                label: 'Lines to Clear',
                defaultValue: 100,
                help: 'First player to clear this many lines wins',
                min: 10,
                max: 999,
                placeholder: '100',
            },
            never: {
                label: 'No Win Condition',
                defaultValue: 0,
                help: 'Match continues until manually ended',
                min: 0,
                max: 0,
                placeholder: '0',
            },
        };

        const config = configs[condition];

        if (!config) {
            console.warn(`Unknown end condition: ${condition}`);
            return;
        }

        if (condition === 'never') {
            valueGroup.style.display = 'none';
        } else {
            valueGroup.style.display = 'block';
            valueLabel.textContent = config.label;
            valueInput.value = config.defaultValue;
            valueInput.min = config.min;
            valueInput.max = config.max;
            valueInput.placeholder = config.placeholder;
            valueHelp.textContent = config.help;
        }
    }

    /**
   * Handle form submission
   */
    handleSubmit() {
        const form = this.container.querySelector('#local-match-config-form');
        if (!form) {
            console.error('[LocalMatchConfig] Form not found');
            return;
        }

        const formData = new FormData(form);

        const config = {
            numPlayers: parseInt(formData.get('numPlayers')),
            endCondition: formData.get('endCondition'),
            endConditionValue: parseInt(formData.get('endConditionValue')) || 0,
            startLevel: parseInt(formData.get('startLevel')) || 1,
            levelProgression: formData.get('levelProgression') === 'on',
            boringRules: formData.get('boringRules') === 'on',
        };

        // Validate
        if (config.numPlayers < 2 || config.numPlayers > 4) {
            alert('Number of players must be between 2 and 4');
            return;
        }

        if (config.startLevel < 1 || config.startLevel > 9) {
            alert('Starting level must be between 1 and 9');
            return;
        }

        if (config.endCondition !== 'never' && config.endConditionValue <= 0) {
            alert('Win condition value must be greater than 0');
            return;
        }

        console.log('[LocalMatchConfig] Starting match with config:', config);

        this.hide();

        if (this.onStartMatch) {
            this.onStartMatch(config);
        }
    }

    /**
   * Show the modal
   */
    show() {
        if (!this.container) {
            console.error('[LocalMatchConfig] Container not found');
            return;
        }

        this.container.classList.remove('hidden');
        this.container.classList.add('show');

        // Initialize UI state
        const endCondition = this.container.querySelector('#end-condition');
        if (endCondition) {
            this.updateEndConditionUI(endCondition.value);
        }

        console.log('[LocalMatchConfig] Modal shown');
    }

    /**
   * Hide the modal
   */
    hide() {
        if (!this.container) {
            return;
        }

        this.container.classList.remove('show');
        this.container.classList.add('hidden');

        console.log('[LocalMatchConfig] Modal hidden');
    }

    /**
   * Cancel the configuration (hide and trigger cancel callback)
   */
    async cancel() {
        this.hide();

        if (this.onCancel) {
            console.log('[LocalMatchConfig] Triggering cancel callback');
            await this.onCancel();
            console.log('[LocalMatchConfig] Cancel callback completed');
        }
    }

    /**
   * Destroy the modal and remove from DOM
   */
    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
            this.container = null;
        }
    }
}
