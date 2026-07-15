/**
 * Local Match Configuration Modal
 *
 * UI for configuring local multiplayer matches (2-4 players, each human or bot).
 *
 * Layout: two zones — a grid of per-player SLOT CARDS (each consolidating the
 * slot's human/bot toggle, bot skill, handicap, and team) and a MATCH RULES
 * area — with a sticky Start Match footer. All dropdowns are themed CosmicSelects
 * (the cosmic cursor works over them; native <select> popups break it). The
 * native <select>s remain as the form source of truth, so the emitted config is
 * byte-identical to the previous form-based implementation.
 */

import { csIcon } from './components/cosmic-icons.js';
import { enhanceSelect, enhanceSegmented } from './components/cosmic-select.js';
import { TEAM_COLORS } from '../core/multi-player-state.js';

const BOT_SKILL_TIERS = [
    'Rookie', 'Novice', 'Learner', 'Steady', 'Skilled',
    'Sharp', 'Expert', 'Master', 'Ace', 'Machine',
];
const DEFAULT_BOT_SKILL = 5;

// The card accent for a given team id, sourced from the SAME palette the game
// uses at runtime (A=Blue, B=Red, C=Green, D=Amber) so the setup card is a true
// preview of the board border / HUD / garbage color.
const teamAccent = (teamId) => (TEAM_COLORS[teamId] || TEAM_COLORS[0]).primary;

/**
 * Map an attack-style selection to a garbage `rules` object understood by
 * core/garbage.js `calculateGarbage`. Values match ATTACK_TYPES in that module.
 */
function attackRulesFor(style) {
    switch (style) {
    case 'blind':
        return { forceAttackType: 'blind' };
    case 'full_blind':
        return { forceAttackType: 'full_blind' };
    case 'hot_potato':
        return { forceAttackType: 'potato', potatoDurationMs: 12000, potatoPenaltyLines: 6 };
    case 'peaceful':
        return { disableAttacks: true };
    default:
        return null;
    }
}

/**
 * Pure config assembler — takes a plain object of form values (as produced by
 * FormData: missing/unchecked => undefined, checkboxes => 'on') and returns the
 * match config. Kept pure (no DOM) so the data contract is unit-testable.
 */
export function buildLocalMatchConfig(values = {}) {
    const get = (key) => values[key];
    const numPlayers = parseInt(get('numPlayers'), 10);
    const matchMode = get('matchMode');
    const endCondition = get('endCondition');
    const isInfinityLMS = matchMode === 'infinity-lms';
    const rawInfinityRows = parseInt(get('infinityMaxRows'), 10);
    const infinityMaxRows = Number.isFinite(rawInfinityRows)
        ? Math.min(1000, Math.max(100, rawInfinityRows))
        : 100;
    const attackStyle = get('attackStyle') || 'standard';

    const config = {
        numPlayers,
        endCondition: isInfinityLMS ? 'infinity-lms' : endCondition,
        isInfinityLMS,
        infinityMaxRows,
        boringRules: get('boringRules') === 'on',
        attackStyle,
        attackRules: attackRulesFor(attackStyle),
    };

    // Every slot always carries a team; default is the player's OWN team
    // (P1=A, P2=B, P3=C, P4=D). isTeamMode is DERIVED, not a toggle: teams only
    // matter when 2+ players share a team but not everyone is on a single team.
    // All-distinct => FFA; everyone on one team => also FFA (so a degenerate
    // single-team config can never strand a round with no opponents).
    config.playerTeams = [];
    for (let i = 1; i <= numPlayers; i++) {
        const team = parseInt(get(`player${i}Team`), 10);
        config.playerTeams.push(Number.isInteger(team) ? team : i - 1);
    }
    const distinctTeams = new Set(config.playerTeams).size;
    config.isTeamMode = distinctTeams >= 2 && distinctTeams < numPlayers;
    config.hotPotato = config.attackStyle === 'hot_potato';
    if (config.hotPotato) {
        config.potatoDurationMs = 12000;
        config.potatoPenaltyLines = 6;
    }

    if (!isInfinityLMS) {
        config.endConditionValue = parseInt(get('endConditionValue'), 10) || 0;
        config.startLevel = parseInt(get('startLevel'), 10) || 1;
        config.levelProgression = get('levelProgression') === 'on';
    }

    config.playerHandicaps = [];
    for (let i = 1; i <= numPlayers; i++) {
        const level = parseInt(get(`player${i}Handicap`), 10);
        config.playerHandicaps.push(Number.isFinite(level) ? level : 2);
    }

    config.playerSlots = [];
    for (let i = 1; i <= numPlayers; i++) {
        const kind = get(`player${i}Kind`) === 'bot' ? 'bot' : 'human';
        const rawDifficulty = parseInt(get(`player${i}BotDifficulty`), 10);
        const difficulty = Number.isFinite(rawDifficulty)
            ? Math.min(10, Math.max(1, rawDifficulty))
            : 10;
        config.playerSlots.push({
            difficulty,
            handicap: config.playerHandicaps[i - 1],
            kind,
            name: kind === 'bot' ? `Bot ${i}` : `Player ${i}`,
            slot: i - 1,
        });
    }

    return config;
}

export class LocalMatchConfigModal {
    constructor(onStartMatch, onCancel = null) {
        this.onStartMatch = onStartMatch;
        this.onCancel = onCancel;
        this.container = null;
        this._enhancers = [];

        this.createUI();
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'local-match-config-modal';
        this.container.className = 'match-config-modal hidden';

        this.container.innerHTML = `
      <div class="match-config-overlay"></div>
      <div class="match-config-content lmc">
        <div class="match-config-header">
          <h2>${csIcon('gamepad', 26, 'lmc-title-icon')}<span class="lmc-title-text">Local Multiplayer Setup</span></h2>
          <button class="close-btn" id="close-local-match-config" aria-label="Close">✕</button>
        </div>

        <form id="local-match-config-form" class="match-config-form">
          <div class="lmc-body">
            <!-- PLAYERS ZONE -->
            <section class="lmc-zone">
              <div class="lmc-zone__head">
                <span class="lmc-zone__title">Players</span>
                <select id="num-players" name="numPlayers" data-cosmic-variant="segmented"
                        aria-label="Number of players">
                  <option value="2" selected>2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </div>
              <div id="player-slot-cards" class="lmc-slot-grid"></div>
              <small class="form-help">Set any slot to a Bot and pick its skill. Each player starts on
                their own team — put two players on the same Team to make them allies (shared color,
                no friendly fire).</small>
            </section>

            <!-- MATCH RULES ZONE -->
            <section class="lmc-zone">
              <div class="lmc-zone__title">Match Rules</div>
              <div class="lmc-rules">
                <div class="cosmic-field">
                  <label for="match-mode">Game Mode</label>
                  <select id="match-mode" name="matchMode" data-cosmic-variant="segmented">
                    <option value="ffa" selected>FFA</option>
                    <option value="infinity-lms">Infinity LMS</option>
                  </select>
                  <small class="form-help" id="match-mode-help">Classic FFA with customizable win conditions</small>
                </div>

                <div class="cosmic-field" id="attack-style-group">
                  <label for="attack-style">Attack Style</label>
                  <select id="attack-style" name="attackStyle">
                    <option value="standard" selected>Standard — Line Garbage</option>
                    <option value="blind">Blind — garbage + temporary blackout</option>
                    <option value="full_blind">Full Blind — heavier, longer blackout</option>
                    <option value="hot_potato">Hot Potato — pass the timer bomb</option>
                    <option value="peaceful">Peaceful — no attacks</option>
                  </select>
                  <small class="form-help" id="attack-style-help">Classic garbage lines sent on multi-line clears</small>
                </div>

                <div class="cosmic-field" id="end-condition-group">
                  <label for="end-condition">Win Condition</label>
                  <select id="end-condition" name="endCondition">
                    <option value="frags" selected>Frags (Kills)</option>
                    <option value="time">Time Limit</option>
                    <option value="points">Score Target</option>
                    <option value="lines">Lines Cleared</option>
                    <option value="never">Never (Play Forever)</option>
                  </select>
                </div>

                <div class="cosmic-field" id="infinity-rows-group">
                  <label for="infinity-max-rows">Infinity Row Cap</label>
                  <input type="number" id="infinity-max-rows" name="infinityMaxRows"
                         min="100" max="1000" value="100" placeholder="100" />
                  <small class="form-help">Default 100, max 1000 rows</small>
                </div>

                <div class="cosmic-field" id="end-value-group">
                  <label for="end-condition-value" id="end-value-label">Frags to Win</label>
                  <input type="number" id="end-condition-value" name="endConditionValue"
                         min="1" max="999" value="7" placeholder="7" />
                  <small class="form-help" id="end-value-help">First player to reach 7 frags wins</small>
                </div>
              </div>

              <details class="advanced-settings">
                <summary>${csIcon('gear', 18, 'lmc-summary-icon')}<span>Advanced Settings</span></summary>

                <div class="form-group">
                  <label for="start-level">Starting Level (1-9)</label>
                  <div class="lmc-number-stepper" data-stepper-for="start-level">
                    <input type="number" id="start-level" name="startLevel"
                           min="1" max="9" value="1" placeholder="1" inputmode="numeric" />
                    <div class="lmc-number-stepper__controls">
                      <button type="button" class="lmc-number-stepper__button lmc-number-stepper__button--up"
                              data-start-level-step="1" aria-label="Increase starting level"></button>
                      <button type="button" class="lmc-number-stepper__button lmc-number-stepper__button--down"
                              data-start-level-step="-1" aria-label="Decrease starting level"></button>
                    </div>
                  </div>
                  <small class="form-help">Higher level = faster pieces</small>
                </div>

                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="level-progression" name="levelProgression" />
                    <span>Enable Level Progression</span>
                  </label>
                  <small class="form-help">Level increases every 15 lines cleared</small>
                </div>

                <div class="form-group">
                  <label class="checkbox-label">
                    <input type="checkbox" id="boring-rules" name="boringRules" />
                    <span>Boring Rules (No Attack Scaling)</span>
                  </label>
                  <small class="form-help">Attacks always deal full damage (no reduction for 3-4 players)</small>
                </div>
              </details>
            </section>
          </div>

          <div class="lmc-footer form-actions">
            <button type="button" class="btn-secondary" id="cancel-local-match">Cancel</button>
            <button type="submit" class="btn-primary">${csIcon('match-start', 22, 'lmc-action-icon lmc-action-icon--match-start')}<span>Start Match</span></button>
          </div>
        </form>
      </div>
    `;

        document.body.appendChild(this.container);
        this.setupEventListeners();
        // Enhance the static rule dropdowns (slot-card dropdowns are enhanced per render).
        this.enhanceStaticControls();
    }

    enhanceStaticControls() {
        const segmented = ['#num-players', '#match-mode'];
        segmented.forEach((sel) => {
            const el = this.container.querySelector(sel);
            if (el) this._enhancers.push(enhanceSegmented(el));
        });
        ['#attack-style', '#end-condition'].forEach((sel) => {
            const el = this.container.querySelector(sel);
            if (el) this._enhancers.push(enhanceSelect(el));
        });
    }

    setupEventListeners() {
        const onCancel = () => this.cancel();
        this.container.querySelector('#close-local-match-config')?.addEventListener('click', onCancel);
        this.container.querySelector('#cancel-local-match')?.addEventListener('click', onCancel);
        this.container.querySelector('.match-config-overlay')?.addEventListener('click', onCancel);

        this.container.querySelector('#end-condition')?.addEventListener('change', (e) => {
            this.updateEndConditionUI(e.target.value);
        });
        this.container.querySelector('#match-mode')?.addEventListener('change', () => this.refreshFormState());
        this.container.querySelector('#attack-style')?.addEventListener('change', (e) => {
            this.updateAttackStyleUI(e.target.value);
        });

        this.container.querySelector('#local-match-config-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });

        this.container.querySelector('#num-players')?.addEventListener('change', () => {
            this.renderSlotCards();
        });

        this.setupStartingLevelStepper();
        this.setupScrollPerformanceMode();
    }

    setupStartingLevelStepper() {
        const input = this.container.querySelector('#start-level');
        const buttons = this.container.querySelectorAll('[data-start-level-step]');
        if (!input || buttons.length === 0) return;

        const min = parseInt(input.min, 10) || 1;
        const max = parseInt(input.max, 10) || 9;
        const clamp = (value) => Math.min(max, Math.max(min, value));
        const emitValueChange = () => {
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const normalize = () => {
            const parsed = parseInt(input.value, 10);
            input.value = String(clamp(Number.isFinite(parsed) ? parsed : min));
        };

        buttons.forEach((button) => {
            button.addEventListener('click', () => {
                const step = parseInt(button.dataset.startLevelStep, 10) || 0;
                const current = parseInt(input.value, 10);
                input.value = String(clamp((Number.isFinite(current) ? current : min) + step));
                emitValueChange();
            });
        });

        input.addEventListener('blur', normalize);
    }

    setupScrollPerformanceMode() {
        const scrollContainer = this.container.querySelector('.lmc-body');
        if (!scrollContainer) return;

        const scrollIdleDelay = 120;
        let scrollRafId = null;
        let scrollIdleTimeout = null;
        const setMode = (enabled) => this.container.classList.toggle('is-scrolling', enabled);

        const onScroll = () => {
            if (scrollRafId !== null) return;
            scrollRafId = requestAnimationFrame(() => {
                scrollRafId = null;
                setMode(true);
                if (scrollIdleTimeout) clearTimeout(scrollIdleTimeout);
                scrollIdleTimeout = setTimeout(() => {
                    scrollIdleTimeout = null;
                    setMode(false);
                }, scrollIdleDelay);
            });
        };

        scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        this._clearScrollPerf = () => {
            scrollContainer.removeEventListener('scroll', onScroll);
            if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
            if (scrollIdleTimeout) clearTimeout(scrollIdleTimeout);
        };
    }

    getNumPlayers() {
        return parseInt(this.container.querySelector('#num-players')?.value, 10) || 2;
    }

    /**
     * Render the per-player slot cards. Each card consolidates the slot's
     * human/bot toggle, bot skill, handicap and team — preserving any prior
     * selections across re-renders. All <select>s are enhanced to CosmicSelects.
     */
    renderSlotCards() {
        const grid = this.container.querySelector('#player-slot-cards');
        if (!grid) return;

        const numPlayers = this.getNumPlayers();

        // Preserve current selections (read the native selects before clearing).
        const previous = {};
        grid.querySelectorAll('select').forEach((sel) => { previous[sel.name] = sel.value; });

        grid.innerHTML = '';

        for (let i = 1; i <= numPlayers; i++) {
            const kindName = `player${i}Kind`;
            const skillName = `player${i}BotDifficulty`;
            const handicapName = `player${i}Handicap`;
            const teamName = `player${i}Team`;
            const defaultKind = i === 2 ? 'bot' : 'human';
            const kindVal = previous[kindName] ?? defaultKind;

            // Resolve this slot's team: prior selection if still valid for the
            // current player count, else the player's own team (P_i -> Team i).
            let teamId = previous[teamName] !== undefined ? parseInt(previous[teamName], 10) : i - 1;
            if (!Number.isInteger(teamId) || teamId < 0 || teamId >= numPlayers) teamId = i - 1;

            const card = document.createElement('div');
            card.className = 'lmc-slot';
            card.style.setProperty('--slot-accent', teamAccent(teamId));

            const skillOptions = BOT_SKILL_TIERS.map((tierLabel, index) => {
                const tier = index + 1;
                const selected = tier === (parseInt(previous[skillName], 10) || DEFAULT_BOT_SKILL);
                return `<option value="${tier}" ${selected ? 'selected' : ''}>Lv${tier} · ${tierLabel}</option>`;
            }).join('');

            // Team options A..D, capped at the player count (no point offering a
            // team a player could never share). Default = the slot's own team.
            const teamOptions = Array.from({ length: numPlayers }, (_, t) => {
                const letter = String.fromCharCode(65 + t);
                return `<option value="${t}" ${t === teamId ? 'selected' : ''}>Team ${letter}</option>`;
            }).join('');

            card.innerHTML = `
                <div class="lmc-slot__head">
                    <span class="lmc-slot__badge">P${i}</span>
                    <span class="lmc-slot__name">Player ${i}</span>
                </div>
                <select class="lmc-slot__kind" name="${kindName}" data-cosmic-variant="segmented"
                        aria-label="Player ${i} controller">
                    <option value="human" ${kindVal === 'human' ? 'selected' : ''}>Human</option>
                    <option value="bot" ${kindVal === 'bot' ? 'selected' : ''}>Bot</option>
                </select>
                <div class="cosmic-field lmc-slot__skill">
                    <label for="${skillName}">Bot Skill</label>
                    <select id="${skillName}" name="${skillName}">${skillOptions}</select>
                </div>
                <div class="cosmic-field lmc-slot__handicap">
                    <label for="${handicapName}">Handicap</label>
                    <select id="${handicapName}" name="${handicapName}">
                        <option value="0">Beginner</option>
                        <option value="1">Apprentice</option>
                        <option value="2">Intermediate</option>
                        <option value="3">Master</option>
                        <option value="4">Grandmaster</option>
                    </select>
                </div>
                <div class="cosmic-field lmc-slot__team">
                    <label for="${teamName}">Team</label>
                    <select id="${teamName}" name="${teamName}">
                        ${teamOptions}
                    </select>
                </div>
            `;

            const handicapSelect = card.querySelector(`[name="${handicapName}"]`);
            handicapSelect.value = previous[handicapName] ?? '2';

            grid.appendChild(card);

            // Reflect bot/human state, then enhance every select on the card.
            const kindSelect = card.querySelector(`[name="${kindName}"]`);
            const skillSelect = card.querySelector(`[name="${skillName}"]`);
            const applyKind = () => {
                const isBot = kindSelect.value === 'bot';
                card.classList.toggle('is-bot', isBot);
                skillSelect.disabled = !isBot;
                skillSelect._cosmicSelect?.syncDisabled();
            };
            kindSelect.addEventListener('change', applyKind);

            // Live-preview the runtime color: changing a slot's team recolors
            // its accent to that team's color, so two slots on the same team
            // show the same color the boards/garbage will use in-game.
            const teamSelect = card.querySelector(`[name="${teamName}"]`);
            teamSelect.addEventListener('change', () => {
                card.style.setProperty('--slot-accent', teamAccent(parseInt(teamSelect.value, 10)));
            });

            this._enhancers.push(enhanceSegmented(kindSelect));
            this._enhancers.push(enhanceSelect(skillSelect));
            this._enhancers.push(enhanceSelect(handicapSelect));
            this._enhancers.push(enhanceSelect(teamSelect));
            applyKind();
        }
    }

    updateEndConditionUI(condition) {
        const valueGroup = this.container.querySelector('#end-value-group');
        const valueLabel = this.container.querySelector('#end-value-label');
        const valueInput = this.container.querySelector('#end-condition-value');
        const valueHelp = this.container.querySelector('#end-value-help');
        if (!valueGroup || !valueLabel || !valueInput || !valueHelp) return;

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

        valueGroup.style.display = '';
        valueLabel.textContent = config.label;
        valueInput.value = config.defaultValue;
        valueInput.min = config.min;
        valueInput.max = config.max;
        valueInput.placeholder = config.placeholder;
        valueHelp.textContent = config.help;
    }

    refreshFormState() {
        const matchMode = this.container.querySelector('#match-mode');
        const modeHelp = this.container.querySelector('#match-mode-help');
        const endConditionGroup = this.container.querySelector('#end-condition-group');
        const endCondition = this.container.querySelector('#end-condition');
        const valueGroup = this.container.querySelector('#end-value-group');
        const infinityRowsGroup = this.container.querySelector('#infinity-rows-group');
        const startLevelGroup = this.container.querySelector('#start-level')?.closest('.form-group');
        const levelProgressionGroup = this.container.querySelector('#level-progression')?.closest('.form-group');
        if (!matchMode) return;

        const isInfinity = matchMode.value === 'infinity-lms';
        if (modeHelp) {
            modeHelp.textContent = isInfinity
                ? 'Last player standing wins. Set the row cap below (100-1000)'
                : 'Classic FFA with customizable win conditions';
        }
        if (endConditionGroup) endConditionGroup.style.display = isInfinity ? 'none' : '';
        if (valueGroup) valueGroup.style.display = isInfinity ? 'none' : '';
        if (infinityRowsGroup) infinityRowsGroup.style.display = isInfinity ? '' : 'none';
        if (startLevelGroup) startLevelGroup.style.display = isInfinity ? 'none' : '';
        if (levelProgressionGroup) levelProgressionGroup.style.display = isInfinity ? 'none' : '';

        if (!isInfinity && endCondition) this.updateEndConditionUI(endCondition.value);
    }

    updateAttackStyleUI(style) {
        const help = this.container.querySelector('#attack-style-help');
        if (!help) return;
        const helpText = {
            standard: 'Classic garbage lines sent on multi-line clears',
            blind: 'Quadra Blind: garbage lines plus a short blackout of the target board',
            full_blind: 'Quadra Full Blind: a stronger, longer blackout attack',
            hot_potato: 'Hold the potato too long and it detonates; clear lines to pass it',
            peaceful: 'No attacks are sent — a calm, non-competitive match',
        };
        help.textContent = helpText[style] || helpText.standard;
    }

    handleSubmit() {
        const form = this.container.querySelector('#local-match-config-form');
        if (!form) {
            console.error('[LocalMatchConfig] Form not found');
            return;
        }

        const values = {};
        new FormData(form).forEach((value, key) => { values[key] = value; });
        const config = buildLocalMatchConfig(values);

        if (config.numPlayers < 2 || config.numPlayers > 4) {
            alert('Number of players must be between 2 and 4');
            return;
        }
        if (!config.isInfinityLMS) {
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
        if (this.onStartMatch) this.onStartMatch(config);
    }

    show() {
        if (!this.container) {
            console.error('[LocalMatchConfig] Container not found');
            return;
        }
        this.container.classList.remove('hidden');
        this.container.classList.add('show');

        const endCondition = this.container.querySelector('#end-condition');
        if (endCondition) this.updateEndConditionUI(endCondition.value);
        const attackStyle = this.container.querySelector('#attack-style');
        if (attackStyle) this.updateAttackStyleUI(attackStyle.value);
        this.renderSlotCards();
        this.refreshFormState();
        console.log('[LocalMatchConfig] Modal shown');
    }

    hide() {
        if (!this.container) return;
        this.container.classList.remove('show');
        this.container.classList.add('hidden');
        console.log('[LocalMatchConfig] Modal hidden');
    }

    async cancel() {
        this.hide();
        if (this.onCancel) {
            await this.onCancel();
        }
    }

    destroy() {
        if (this._clearScrollPerf) {
            this._clearScrollPerf();
            this._clearScrollPerf = null;
        }
        this._enhancers.forEach((enhancer) => enhancer?.destroy?.());
        this._enhancers = [];
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
            this.container = null;
        }
    }
}
