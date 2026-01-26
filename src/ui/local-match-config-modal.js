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

          <!-- Game Mode -->
          <div class="form-group">
            <label for="match-mode">Game Mode</label>
            <select id="match-mode" name="matchMode">
              <option value="ffa" selected>FFA (Free-for-All)</option>
              <option value="infinity-lms">Infinity LMS (Last Standing)</option>
            </select>
            <small class="form-help" id="match-mode-help">Classic FFA with customizable win conditions</small>
          </div>
          
          <!-- Win Condition -->
          <div class="form-group" id="end-condition-group">
            <label for="end-condition">Win Condition</label>
            <select id="end-condition" name="endCondition">
              <option value="frags" selected>Frags (Kills)</option>
              <option value="time">Time Limit</option>
              <option value="points">Score Target</option>
              <option value="lines">Lines Cleared</option>
              <option value="never">Never (Play Forever)</option>
            </select>
          </div>

          <!-- Infinity LMS Row Cap -->
          <div class="form-group" id="infinity-rows-group">
            <label for="infinity-max-rows">Infinity Row Cap</label>
            <input
              type="number"
              id="infinity-max-rows"
              name="infinityMaxRows"
              min="100"
              max="1000"
              value="100"
              placeholder="100"
            />
            <small class="form-help">Default 100, max 1000 rows</small>
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

            <div class="form-group">
                <label class="checkbox-label">
                    <input 
                        type="checkbox" 
                        id="team-mode" 
                        name="teamMode"
                    />
                    <span>Play in Teams</span>
                </label>
                <small class="form-help">Allies share frags and do not attack each other</small>
            </div>

            <div id="team-selection-area" class="team-selection-area hidden" style="margin-top: 20px; padding-top: 20px; border-top: 2px solid rgba(139, 92, 246, 0.3);">
                <div class="form-group" style="margin-bottom: 15px;">
                    <label>Team Assignments</label>
                </div>
                <div id="player-team-assignments" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <!-- Player team dropdowns inserted here -->
                </div>
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

        // Match mode change handler
        const matchMode = this.container.querySelector('#match-mode');
        if (matchMode) {
            matchMode.addEventListener('change', () => {
                this.refreshFormState();
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

        // Team mode toggle
        const teamModeToggle = this.container.querySelector('#team-mode');
        if (teamModeToggle) {
            teamModeToggle.addEventListener('change', (e) => {
                this.updateTeamUI(e.target.checked);
            });
        }

        // Num players change should re-render team UI if open
        const numPlayers = this.container.querySelector('#num-players');
        if (numPlayers) {
            numPlayers.addEventListener('change', () => {
                if (teamModeToggle && teamModeToggle.checked) {
                    this.updateTeamUI(true);
                }
            });
        }
    }

    /**
   * Update team assignment UI based on player count and toggle
   */
    updateTeamUI(isActive) {
        const teamArea = this.container.querySelector('#team-selection-area');
        const assignmentsArea = this.container.querySelector('#player-team-assignments');
        if (!teamArea || !assignmentsArea) return;

        if (!isActive) {
            teamArea.classList.add('hidden');
            return;
        }

        teamArea.classList.remove('hidden');
        assignmentsArea.innerHTML = '';

        const numPlayers = parseInt(this.container.querySelector('#num-players').value);
        for (let i = 1; i <= numPlayers; i++) {
            const div = document.createElement('div');
            div.className = 'form-group';

            const label = document.createElement('label');
            label.textContent = `Player ${i} Team`;

            const select = document.createElement('select');
            select.name = `player${i}Team`;
            select.innerHTML = `
                <option value="0" ${i <= numPlayers / 2 ? 'selected' : ''}>Team A</option>
                <option value="1" ${i > numPlayers / 2 ? 'selected' : ''}>Team B</option>
            `;

            div.appendChild(label);
            div.appendChild(select);
            assignmentsArea.appendChild(div);
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
            return;
        }

        valueGroup.style.display = 'block';
        valueLabel.textContent = config.label;
        valueInput.value = config.defaultValue;
        valueInput.min = config.min;
        valueInput.max = config.max;
        valueInput.placeholder = config.placeholder;
        valueHelp.textContent = config.help;
    }

    /**
 * Sync form UI state based on selected match mode
 */
    refreshFormState() {
        const matchMode = this.container.querySelector('#match-mode');
        const modeHelp = this.container.querySelector('#match-mode-help');
        const endConditionGroup = this.container.querySelector('#end-condition-group');
        const endCondition = this.container.querySelector('#end-condition');
        const valueGroup = this.container.querySelector('#end-value-group');
        const infinityRowsGroup = this.container.querySelector('#infinity-rows-group');
        const startLevelGroup = this.container.querySelector('#start-level')?.parentElement;
        const levelProgressionGroup = this.container.querySelector('#level-progression')?.parentElement;

        if (!matchMode) {
            return;
        }

        const isInfinity = matchMode.value === 'infinity-lms';

        if (modeHelp) {
            modeHelp.textContent = isInfinity
                ? 'Last player standing wins. Set the row cap below (100-1000)'
                : 'Classic FFA with customizable win conditions';
        }

        if (endConditionGroup) {
            endConditionGroup.style.display = isInfinity ? 'none' : '';
        }

        if (valueGroup) {
            valueGroup.style.display = isInfinity ? 'none' : '';
        }

        if (infinityRowsGroup) {
            infinityRowsGroup.style.display = isInfinity ? 'flex' : 'none';
        }

        if (startLevelGroup) startLevelGroup.style.display = isInfinity ? 'none' : '';
        if (levelProgressionGroup) levelProgressionGroup.style.display = isInfinity ? 'none' : '';

        if (!isInfinity && endCondition) {
            this.updateEndConditionUI(endCondition.value);
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
        const matchMode = formData.get('matchMode');
        const endCondition = formData.get('endCondition');
        const isInfinityLMS = matchMode === 'infinity-lms';
        const rawInfinityRows = parseInt(formData.get('infinityMaxRows'), 10);
        const infinityMaxRows = Number.isFinite(rawInfinityRows)
            ? Math.min(1000, Math.max(100, rawInfinityRows))
            : 100;

        const config = {
            numPlayers: parseInt(formData.get('numPlayers')),
            endCondition: isInfinityLMS ? 'infinity-lms' : endCondition,
            isInfinityLMS,
            infinityMaxRows,
            isTeamMode: formData.get('teamMode') === 'on',
            playerTeams: [],
            boringRules: formData.get('boringRules') === 'on',
        };

        // Only include these fields if NOT in infinity mode
        if (!isInfinityLMS) {
            config.endConditionValue = parseInt(formData.get('endConditionValue')) || 0;
            config.startLevel = parseInt(formData.get('startLevel')) || 1;
            config.levelProgression = formData.get('levelProgression') === 'on';
        }

        if (config.isTeamMode) {
            for (let i = 1; i <= config.numPlayers; i++) {
                config.playerTeams.push(parseInt(formData.get(`player${i}Team`)) || 0);
            }
        }

        // Validate
        if (config.numPlayers < 2 || config.numPlayers > 4) {
            alert('Number of players must be between 2 and 4');
            return;
        }

        if (!isInfinityLMS) {
            if (config.startLevel < 1 || config.startLevel > 9) {
                alert('Starting level must be between 1 and 9');
                return;
            }

            if (config.endCondition !== 'never' && config.endConditionValue <= 0) {
                alert('Win condition value must be greater than 0');
                return;
            }
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
        this.refreshFormState();

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
