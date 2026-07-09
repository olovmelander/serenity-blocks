/**
 * Match Configuration Modal
 *
 * UI for configuring and creating new FFA matches
 */

export class MatchConfigModal {
    constructor(onCreateMatch) {
        this.onCreateMatch = onCreateMatch;
        this.container = null;

        this.createUI();
    }

    /**
   * Create the match config UI
   */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'match-config-modal';
        this.container.className = 'match-config-modal hidden';

        this.container.innerHTML = `
      <div class="match-config-overlay"></div>
      <div class="match-config-content">
        <div class="match-config-header">
          <h2>⚙️ Create Match</h2>
          <button class="close-btn" id="close-match-config">✕</button>
        </div>
        
        <form id="match-config-form" class="match-config-form">
          <!-- Match Name -->
          <div class="form-group">
            <label for="match-name">Match Name</label>
            <input 
              type="text" 
              id="match-name" 
              name="matchName"
              placeholder="My Awesome Match"
              maxlength="50"
              required
            />
          </div>
          
          <!-- Max Players -->
          <div class="form-group">
            <label for="max-players">Max Players</label>
            <select id="max-players" name="maxPlayers">
              <option value="2">2 Players</option>
              <option value="3">3 Players</option>
              <option value="4" selected>4 Players</option>
              <option value="5">5 Players</option>
              <option value="6">6 Players</option>
              <option value="7">7 Players</option>
              <option value="8">8 Players</option>
            </select>
          </div>
          
          <!-- End Condition -->
          <div class="form-group">
            <label for="end-condition">Win Condition</label>
            <select id="end-condition" name="endCondition">
              <option value="frags" selected>Frags (Kills)</option>
              <option value="time">Time Limit</option>
              <option value="points">Score Target</option>
              <option value="lines">Lines Cleared</option>
              <option value="never">Never (Manual End)</option>
            </select>
          </div>
          
          <!-- End Condition Value -->
          <div class="form-group" id="end-value-group">
            <label for="end-condition-value" id="end-value-label">Frags to Win</label>
            <input 
              type="number" 
              id="end-condition-value" 
              name="endConditionValue"
              min="1"
              max="999"
              value="10"
            />
            <small class="form-help" id="end-value-help">First player to reach 10 frags wins</small>
          </div>
          
          <!-- Lobby Type -->
          <div class="form-group">
            <label for="lobby-type">Lobby Type</label>
            <select id="lobby-type" name="lobbyType">
              <option value="public" selected>Public (Anyone can join)</option>
              <option value="friends">Friends Only</option>
              <option value="private">Private (Invite only)</option>
            </select>
          </div>
          
          <!-- Advanced Settings -->
          <details class="advanced-settings">
            <summary>⚙️ Advanced Settings</summary>

            <div class="form-group">
              <label for="online-attack-style">Attack Style</label>
              <select id="online-attack-style" name="attackStyle">
                <option value="standard" selected>Standard - Line Garbage</option>
                <option value="blind">Blind - garbage plus blackout</option>
                <option value="full_blind">Full Blind - heavier blackout</option>
                <option value="hot_potato">Hot Potato - pass the timer bomb</option>
                <option value="peaceful">Peaceful - no attacks</option>
              </select>
              <small class="form-help" id="online-attack-style-help">Classic garbage lines sent on multi-line clears</small>
            </div>

            <div class="form-group">
              <label for="garbage-cancellation">Garbage Cancellation</label>
              <select id="garbage-cancellation" name="garbageCancellation">
                <option value="full" selected>Full (Modern)</option>
                <option value="disabled">Disabled (Classic)</option>
              </select>
              <small class="form-help">Full: Outgoing lines cancel incoming garbage 1:1 (Quadra/TETR.IO style). Disabled: Classic mode, no cancellation.</small>
            </div>

            <div class="form-group">
              <label class="checkbox-label">
                <input type="checkbox" id="boring-rules" name="boringRules" />
                <span>Boring Rules (Disable attack scaling)</span>
              </label>
              <small class="form-help">Classic Quadra mode - no attack reduction with 3+ players</small>
            </div>
          </details>
          
          <!-- Buttons -->
          <div class="form-actions">
            <button type="button" class="btn btn-secondary" id="cancel-match-config">
              Cancel
            </button>
            <button type="submit" class="btn btn-primary">
              🚀 Create Match
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
        const closeBtn = this.container.querySelector('#close-match-config');
        closeBtn.addEventListener('click', () => this.hide());

        // Cancel button
        const cancelBtn = this.container.querySelector('#cancel-match-config');
        cancelBtn.addEventListener('click', () => this.hide());

        // Overlay click
        const overlay = this.container.querySelector('.match-config-overlay');
        overlay.addEventListener('click', () => this.hide());

        // End condition change
        const endConditionSelect = this.container.querySelector('#end-condition');
        endConditionSelect.addEventListener('change', (e) => {
            this.updateEndConditionUI(e.target.value);
        });

        const attackStyleSelect = this.container.querySelector('#online-attack-style');
        attackStyleSelect?.addEventListener('change', (e) => {
            this.updateAttackStyleUI(e.target.value);
        });

        // Form submit
        const form = this.container.querySelector('#match-config-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
    }

    /**
   * Update end condition UI based on selection
   */
    updateEndConditionUI(condition) {
        const valueGroup = this.container.querySelector('#end-value-group');
        const valueLabel = this.container.querySelector('#end-value-label');
        const valueInput = this.container.querySelector('#end-condition-value');
        const valueHelp = this.container.querySelector('#end-value-help');

        const configs = {
            frags: {
                label: 'Frags to Win',
                placeholder: '10',
                help: 'First player to reach this many frags wins',
                defaultValue: 10,
                min: 1,
                max: 100,
            },
            time: {
                label: 'Time Limit (minutes)',
                placeholder: '3',
                help: 'Player with highest score after this time wins',
                defaultValue: 3,
                min: 1,
                max: 60,
            },
            points: {
                label: 'Score Target (thousands)',
                placeholder: '10',
                help: 'First player to reach this score wins (e.g., 10 = 10,000 points)',
                defaultValue: 10,
                min: 1,
                max: 999,
            },
            lines: {
                label: 'Lines to Clear',
                placeholder: '100',
                help: 'First player to clear this many lines wins',
                defaultValue: 100,
                min: 10,
                max: 999,
            },
            never: {
                label: 'No Win Condition',
                placeholder: '0',
                help: 'Match continues until manually ended',
                defaultValue: 0,
                min: 0,
                max: 0,
            },
        };

        const config = configs[condition];

        if (condition === 'never') {
            valueGroup.style.display = 'none';
        } else {
            valueGroup.style.display = 'block';
            valueLabel.textContent = config.label;
            valueInput.placeholder = config.placeholder;
            valueInput.value = config.defaultValue;
            valueInput.min = config.min;
            valueInput.max = config.max;
            valueHelp.textContent = config.help;
        }
    }

    _attackRulesFor(style) {
        switch (style) {
        case 'blind':
            return { forceAttackType: 'blind' };
        case 'full_blind':
            return { forceAttackType: 'full_blind' };
        case 'hot_potato':
            return {
                forceAttackType: 'potato',
                potatoDurationMs: 12000,
                potatoPenaltyLines: 6,
            };
        case 'peaceful':
            return { disableAttacks: true };
        default:
            return null;
        }
    }

    updateAttackStyleUI(style) {
        const help = this.container.querySelector('#online-attack-style-help');
        if (!help) return;

        const helpText = {
            standard: 'Classic garbage lines sent on multi-line clears',
            blind: 'Quadra Blind: garbage lines plus a short blackout of the target board',
            full_blind: 'Quadra Full Blind: a stronger, longer blackout attack',
            hot_potato: 'Hold the potato too long and it detonates; clear lines to pass it',
            peaceful: 'No attacks are sent in this match',
        };

        help.textContent = helpText[style] || helpText.standard;
    }

    /**
   * Handle form submission
   */
    async handleSubmit() {
        const form = this.container.querySelector('#match-config-form');
        const formData = new FormData(form);

        const config = {
            gameName: formData.get('matchName').trim() || 'Unnamed Match',
            maxPlayers: parseInt(formData.get('maxPlayers')),
            lobbyType: formData.get('lobbyType'),
            endCondition: formData.get('endCondition'),
            endConditionValue: parseInt(formData.get('endConditionValue')) || 0,
            boringRules: formData.get('boringRules') === 'on',
            garbageCancellation: formData.get('garbageCancellation') || 'full',
            attackStyle: formData.get('attackStyle') || 'standard',
            attackRules: this._attackRulesFor(formData.get('attackStyle') || 'standard'),
        };
        config.hotPotato = config.attackStyle === 'hot_potato';
        if (config.hotPotato) {
            config.potatoDurationMs = 12000;
            config.potatoPenaltyLines = 6;
        }

        // Validation
        if (config.gameName.length === 0) {
            alert('Please enter a match name');
            return;
        }

        if (config.endCondition !== 'never' && config.endConditionValue <= 0) {
            alert('Please enter a valid win condition value');
            return;
        }

        try {
            console.log('🎮 Creating match with config:', config);

            if (this.onCreateMatch) {
                await this.onCreateMatch(config);
            }

            this.hide();
        } catch (err) {
            console.error('Failed to create match:', err);
            alert(`Failed to create match: ${err.message}`);
        }
    }

    /**
   * Show the modal
   */
    show() {
        this.container.classList.remove('hidden');

        // Focus match name input
        const nameInput = this.container.querySelector('#match-name');
        setTimeout(() => nameInput.focus(), 100);

        // Reset to default values
        this.reset();
    }

    /**
   * Hide the modal
   */
    hide() {
        this.container.classList.add('hidden');
    }

    /**
   * Reset form to defaults
   */
    reset() {
        const form = this.container.querySelector('#match-config-form');
        form.reset();

        // Reset to default end condition UI
        this.updateEndConditionUI('frags');
        this.updateAttackStyleUI('standard');
    }

    /**
   * Destroy the modal
   */
    destroy() {
        if (this.container) {
            this.container.remove();
        }
    }
}
