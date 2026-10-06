/**
 * Match Configuration Modal — "Create a match" (Keystone sheet).
 *
 * UI for configuring and creating new online FFA matches. It replaces the lobby
 * browser while open: Back, the close tile and Escape return to the browser
 * (`onCancel`). A failed create keeps the sheet open with the reason inline.
 * Styles: public/styles/keystone-multiplayer.css (#match-config-modal).
 */
import { enhanceSegmented } from './components/cosmic-select.js';
import {
    closeLayer, focusSoon, mpIcon, openLayer,
} from './components/mp-sheet.js';

const CONDITIONS = {
    frags: {
        label: 'Frags to win',
        unit: 'frags',
        defaultValue: 10,
        min: 1,
        max: 100,
        help: 'The first player to reach this many frags wins.',
    },
    time: {
        label: 'Minutes',
        unit: 'minutes',
        defaultValue: 3,
        min: 1,
        max: 60,
        help: 'The highest score when time runs out wins.',
    },
    points: {
        label: 'Score target, thousands',
        unit: 'thousand points',
        defaultValue: 10,
        min: 1,
        max: 999,
        help: 'The first player to reach this score wins — 10 means 10,000.',
    },
    lines: {
        label: 'Lines to win',
        unit: 'lines',
        defaultValue: 100,
        min: 10,
        max: 999,
        help: 'The first player to clear this many lines wins.',
    },
    never: {
        label: 'No win condition',
        unit: '',
        defaultValue: 0,
        min: 0,
        max: 0,
        help: 'The match runs until the host ends it.',
    },
};

const LOBBY_TYPE_HELP = {
    public: 'Anyone can find it in the list and join.',
    friends: 'Only your Steam friends can join.',
    private: 'Hidden from the list — players join by invite or lobby ID.',
};

const ATTACK_HELP = {
    standard: 'Clearing two or more lines sends garbage lines to an opponent.',
    blind: 'Garbage lines plus a short blackout of the target board.',
    full_blind: 'A heavier attack with a longer blackout.',
    hot_potato: 'Hold the potato too long and it goes off — clear lines to pass it on.',
    peaceful: 'No attacks are sent in this match.',
};

const SEGMENTED = ['#max-players', '#lobby-type', '#online-end-condition', '#online-attack-style', '#garbage-cancellation'];

export class MatchConfigModal {
    /**
     * @param {Function} onCreateMatch resolves when the lobby exists; throws to keep the sheet open
     * @param {Function} [onCancel] Back / Escape — returns to the lobby browser
     */
    constructor(onCreateMatch, onCancel = null) {
        this.onCreateMatch = onCreateMatch;
        this.onCancel = onCancel;
        this.container = null;
        this.submitting = false;
        this._enhancers = [];

        this.createUI();
    }

    /**
   * Create the match config UI
   */
    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'match-config-modal';
        this.container.className = 'match-config-modal sb-mp-screen hidden';

        this.container.innerHTML = `
      <div class="match-config-overlay" aria-hidden="true"></div>
      <div class="sb-mp-sheet" role="dialog" aria-modal="true" aria-labelledby="match-config-title">
        <div class="match-config-content sb-mp-sheet__panel">
          <header class="match-config-header sb-mp-sheet__header">
            <div class="sb-mp-sheet__heading">
              <p class="sb-eyebrow">Online versus</p>
              <h2 class="sb-mp-sheet__title" id="match-config-title">Create a match</h2>
            </div>
            <button type="button" class="sb-mp-close" id="close-match-config" aria-label="Close and return to the match list">${mpIcon('close', 20)}</button>
          </header>

          <form id="match-config-form" class="match-config-form sb-mp-sheet__form" novalidate>
            <div class="sb-mp-sheet__body mc-body">
              <div class="sb-mp-field">
                <label class="sb-mp-field__label" for="match-name">Match name</label>
                <input type="text" id="match-name" name="matchName" class="sb-mp-input"
                  placeholder="Friday night versus" maxlength="50" autocomplete="off" required />
              </div>

              <div class="mc-grid">
                <div class="sb-mp-field">
                  <span class="sb-mp-field__label">Players</span>
                  <select id="max-players" name="maxPlayers" aria-label="Most players">
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4" selected>4</option>
                    <option value="5">5</option>
                    <option value="6">6</option>
                    <option value="7">7</option>
                    <option value="8">8</option>
                  </select>
                  <p class="sb-mp-help">The most players who can join.</p>
                </div>

                <div class="sb-mp-field">
                  <span class="sb-mp-field__label">Who can join</span>
                  <select id="lobby-type" name="lobbyType" aria-label="Who can join">
                    <option value="public" selected>Anyone</option>
                    <option value="friends">Friends</option>
                    <option value="private">Invite only</option>
                  </select>
                  <p class="sb-mp-help" id="lobby-type-help"></p>
                </div>

                <div class="sb-mp-field">
                  <span class="sb-mp-field__label">Win condition</span>
                  <select id="online-end-condition" name="endCondition" aria-label="Win condition">
                    <option value="frags" selected>Frags</option>
                    <option value="time">Time</option>
                    <option value="points">Score</option>
                    <option value="lines">Lines</option>
                    <option value="never">Endless</option>
                  </select>
                </div>

                <div class="sb-mp-field sb-mp-field--inline" id="online-end-value-group">
                  <div class="sb-mp-field__text">
                    <label class="sb-mp-field__label" for="online-end-condition-value" id="online-end-value-label">Frags to win</label>
                    <p class="sb-mp-help" id="online-end-value-help"></p>
                  </div>
                  <div class="sb-stepper" data-stepper-for="online-end-condition-value">
                    <button type="button" class="sb-stepper__btn" data-step="-1" aria-label="Decrease the target">${mpIcon('minus', 16)}</button>
                    <input type="number" id="online-end-condition-value" name="endConditionValue" min="1" max="100" value="10" inputmode="numeric" />
                    <button type="button" class="sb-stepper__btn" data-step="1" aria-label="Increase the target">${mpIcon('plus', 16)}</button>
                  </div>
                </div>
              </div>

              <details class="advanced-settings sb-mp-more">
                <summary><span>More rules</span>${mpIcon('chevron', 16, 'sb-mp-more__chevron')}</summary>
                <div class="sb-mp-more__body">
                  <div class="sb-mp-field">
                    <span class="sb-mp-field__label">Attacks</span>
                    <select id="online-attack-style" name="attackStyle" aria-label="Attacks">
                      <option value="standard" selected>Standard</option>
                      <option value="blind">Blind</option>
                      <option value="full_blind">Full blind</option>
                      <option value="hot_potato">Hot potato</option>
                      <option value="peaceful">Peaceful</option>
                    </select>
                    <p class="sb-mp-help" id="online-attack-style-help">${ATTACK_HELP.standard}</p>
                  </div>
                  <div class="sb-mp-field">
                    <span class="sb-mp-field__label">Garbage cancelling</span>
                    <select id="garbage-cancellation" name="garbageCancellation" aria-label="Garbage cancelling">
                      <option value="full" selected>On</option>
                      <option value="disabled">Off</option>
                    </select>
                    <p class="sb-mp-help" id="garbage-cancellation-help">Lines you send cancel garbage on its way to you, one for one.</p>
                  </div>
                  <label class="sb-mp-switch">
                    <span class="sb-mp-field__text">
                      <span class="sb-mp-field__label">No attack scaling</span>
                      <span class="sb-mp-help">Attacks keep full strength with three or more players.</span>
                    </span>
                    <input type="checkbox" class="sb-toggle" id="online-boring-rules" name="boringRules" />
                  </label>
                </div>
              </details>
            </div>

            <footer class="form-actions sb-mp-sheet__footer">
              <p class="sb-mp-alert" id="match-config-error" role="alert" hidden></p>
              <ul class="sb-hints sb-mp-sheet__hints" aria-hidden="true">
                <li><kbd class="sb-kbd" data-key>Esc</kbd><kbd class="sb-kbd" data-pad>B</kbd>Back</li>
                <li><kbd class="sb-kbd" data-key>Enter</kbd><kbd class="sb-kbd" data-pad>A</kbd>Create</li>
              </ul>
              <div class="sb-mp-sheet__actions">
                <button type="button" class="sb-btn sb-btn--quiet" id="cancel-match-config">Back</button>
                <button type="submit" class="sb-btn sb-btn--primary" id="create-match-submit">Create match</button>
              </div>
            </footer>
          </form>
        </div>
        <span class="sb-mp-sheet__key" aria-hidden="true"></span>
      </div>
    `;

        document.body.appendChild(this.container);

        SEGMENTED.forEach((sel) => {
            const select = this.container.querySelector(sel);
            if (select) this._enhancers.push(enhanceSegmented(select));
        });

        this.setupEventListeners();
    }

    /**
   * Setup event listeners
   */
    setupEventListeners() {
        const back = () => this.cancel();
        this.container.querySelector('#close-match-config').addEventListener('click', back);
        this.container.querySelector('#cancel-match-config').addEventListener('click', back);
        this.container.querySelector('.match-config-overlay').addEventListener('click', back);

        this.container.querySelector('#online-end-condition').addEventListener('change', (e) => {
            this.updateEndConditionUI(e.target.value);
        });
        this.container.querySelector('#online-attack-style')?.addEventListener('change', (e) => {
            this.updateAttackStyleUI(e.target.value);
        });
        this.container.querySelector('#lobby-type')?.addEventListener('change', (e) => {
            this.updateLobbyTypeUI(e.target.value);
        });
        this.container.querySelector('#garbage-cancellation')?.addEventListener('change', (e) => {
            const help = this.container.querySelector('#garbage-cancellation-help');
            if (help) {
                help.textContent = e.target.value === 'disabled'
                    ? 'Garbage always arrives in full, as in the classic game.'
                    : 'Lines you send cancel garbage on its way to you, one for one.';
            }
        });

        // Typing a name is not gameplay.
        this.container.querySelector('#match-name')?.addEventListener('keydown', (e) => e.stopPropagation());

        const form = this.container.querySelector('#match-config-form');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
        form.addEventListener('input', () => this.clearError());

        this.container.querySelectorAll('.sb-stepper').forEach((wrap) => {
            const input = wrap.querySelector('input');
            wrap.querySelectorAll('[data-step]').forEach((button) => {
                button.addEventListener('click', () => {
                    const min = parseInt(input.min, 10) || 0;
                    const max = parseInt(input.max, 10) || 0;
                    const current = parseInt(input.value, 10);
                    const next = (Number.isFinite(current) ? current : min) + (parseInt(button.dataset.step, 10) || 0);
                    input.value = String(Math.min(max, Math.max(min, next)));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
            });
        });
    }

    /**
   * Update end condition UI based on selection
   */
    updateEndConditionUI(condition) {
        const valueGroup = this.container.querySelector('#online-end-value-group');
        const valueLabel = this.container.querySelector('#online-end-value-label');
        const valueInput = this.container.querySelector('#online-end-condition-value');
        const valueHelp = this.container.querySelector('#online-end-value-help');
        const config = CONDITIONS[condition] || CONDITIONS.frags;

        if (condition === 'never') {
            valueGroup.hidden = true;
            return;
        }
        valueGroup.hidden = false;
        valueLabel.textContent = config.label;
        valueInput.placeholder = String(config.defaultValue);
        valueInput.min = config.min;
        valueInput.max = config.max;
        valueInput.value = config.defaultValue;
        valueHelp.textContent = config.help;
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
        help.textContent = ATTACK_HELP[style] || ATTACK_HELP.standard;
    }

    updateLobbyTypeUI(type) {
        const help = this.container.querySelector('#lobby-type-help');
        if (help) help.textContent = LOBBY_TYPE_HELP[type] || LOBBY_TYPE_HELP.public;
    }

    showError(message, field = null) {
        const alert = this.container.querySelector('#match-config-error');
        alert.textContent = message;
        alert.hidden = false;
        this.container.querySelector('.sb-mp-sheet__footer')?.classList.add('has-error');
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.focus();
        }
    }

    clearError() {
        const alert = this.container?.querySelector('#match-config-error');
        if (!alert || alert.hidden) return;
        alert.hidden = true;
        alert.textContent = '';
        this.container.querySelector('.sb-mp-sheet__footer')?.classList.remove('has-error');
        this.container.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    }

    setSubmitting(submitting) {
        this.submitting = submitting;
        const submit = this.container.querySelector('#create-match-submit');
        if (!submit) return;
        submit.disabled = submitting;
        submit.setAttribute('aria-busy', submitting ? 'true' : 'false');
        submit.textContent = submitting ? 'Creating…' : 'Create match';
    }

    /**
   * Handle form submission
   */
    async handleSubmit() {
        if (this.submitting) return;
        const form = this.container.querySelector('#match-config-form');
        const formData = new FormData(form);

        const config = {
            gameName: (formData.get('matchName') || '').trim() || 'Unnamed Match',
            maxPlayers: parseInt(formData.get('maxPlayers'), 10),
            lobbyType: formData.get('lobbyType'),
            endCondition: formData.get('endCondition'),
            endConditionValue: parseInt(formData.get('endConditionValue'), 10) || 0,
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
        if (config.endCondition !== 'never' && config.endConditionValue <= 0) {
            const unit = CONDITIONS[config.endCondition]?.unit || 'points';
            this.showError(`Set how many ${unit} win the match.`, this.container.querySelector('#online-end-condition-value'));
            return;
        }

        this.clearError();
        this.setSubmitting(true);
        try {
            console.log('🎮 Creating match with config:', config);

            if (this.onCreateMatch) {
                await this.onCreateMatch(config);
            }

            this.hide();
        } catch (err) {
            console.error('Failed to create match:', err);
            this.showError(`The match could not be created. ${err?.message || 'Try again in a moment.'}`.trim());
        } finally {
            this.setSubmitting(false);
        }
    }

    /**
   * Show the modal
   */
    show() {
        this.container.classList.remove('hidden');

        // Reset to default values
        this.reset();
        openLayer(this.container, () => this.cancel());

        // Focus match name input
        focusSoon(() => this.container?.querySelector('#match-name'));
    }

    /**
   * Hide the modal
   */
    hide() {
        this.container.classList.add('hidden');
        closeLayer(this.container);
    }

    /** Back: close the sheet and return to whatever opened it (the lobby browser). */
    async cancel() {
        if (this.submitting) return;
        this.hide();
        if (this.onCancel) await this.onCancel();
    }

    /**
   * Reset form to defaults
   */
    reset() {
        const form = this.container.querySelector('#match-config-form');
        form.reset();
        // form.reset() fires no change events: redraw the segmented controls.
        this._enhancers.forEach((enhancer) => enhancer?.refresh?.());

        // Reset to default end condition UI
        this.updateEndConditionUI('frags');
        this.updateAttackStyleUI('standard');
        this.updateLobbyTypeUI('public');
        this.clearError();
        this.setSubmitting(false);
    }

    /**
   * Destroy the modal
   */
    destroy() {
        if (this.container) {
            closeLayer(this.container);
            this._enhancers.forEach((enhancer) => enhancer?.destroy?.());
            this._enhancers = [];
            this.container.remove();
        }
    }
}
