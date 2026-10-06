/**
 * Local Match Configuration Modal — "Local versus" (Keystone sheet).
 *
 * UI for configuring local multiplayer matches (2-4 players, each human or bot).
 * Opened by the main menu's Local Versus entry; Escape, the close tile and Back all
 * return to the menu.
 *
 * Layout: one sheet with an open corner — the PLAYERS zone (a seat card per player
 * with its hue, human/bot, bot skill, handicap and team) and the RULES zone
 * (segmented controls), with Back and the one primary action, Start match, in the
 * footer. Every control is a CosmicSelect over a native <select> (the cosmic cursor
 * works over them; native <select> popups break it). The native <select>s remain the
 * form source of truth, so the emitted config is unchanged: `buildLocalMatchConfig`
 * is pure and keeps its field names. The last setup is remembered locally.
 *
 * Styles: public/styles/keystone-multiplayer.css (#local-match-config-modal).
 */

import { enhanceSelect, enhanceSegmented } from './components/cosmic-select.js';
import {
    closeLayer, focusSoon, mpIcon, openLayer,
} from './components/mp-sheet.js';

/** Bot skill names, 1–10 (the versus plates name a bot's skill with them too). */
export const BOT_SKILL_TIERS = [
    'Rookie', 'Novice', 'Learner', 'Steady', 'Skilled',
    'Sharp', 'Expert', 'Master', 'Ace', 'Machine',
];
const DEFAULT_BOT_SKILL = 5;
const LAST_SETUP_KEY = 'serenity.localMatch.lastSetup';

// Each seat wears its team's hue, in the pastel family of the logo: Team A sky,
// B rose, C mint, D gold — the same order as the runtime board colours (blue, red,
// green, amber), so two seats on one team share a colour here as they do in play.
const SEAT_HUES = ['sky', 'rose', 'mint', 'gold'];
const seatHue = (teamId) => SEAT_HUES[teamId] || SEAT_HUES[0];

const CONDITION_COPY = {
    frags: {
        label: 'Frags to win',
        unit: 'frags',
        defaultValue: 7,
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
        help: 'The match runs until you end it.',
    },
};

const ATTACK_HELP = {
    standard: 'Clearing two or more lines sends garbage lines to an opponent.',
    blind: 'Garbage lines plus a short blackout of the target board.',
    full_blind: 'A heavier attack with a longer blackout.',
    hot_potato: 'Hold the potato too long and it goes off — clear lines to pass it on.',
    peaceful: 'No attacks are sent — a calm, side-by-side match.',
};

function readLastSetup() {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_SETUP_KEY) : null;
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function writeLastSetup(values) {
    try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(LAST_SETUP_KEY, JSON.stringify(values));
    } catch { /* private mode: the next setup simply starts from the defaults */ }
}

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

const stepper = (id, name, {
    min, max, value, step = 1, label,
}) => `
    <div class="sb-stepper" data-stepper-for="${id}">
        <button type="button" class="sb-stepper__btn" data-step="-${step}" aria-label="Decrease ${label}">${mpIcon('minus', 16)}</button>
        <input type="number" id="${id}" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}" inputmode="numeric" />
        <button type="button" class="sb-stepper__btn" data-step="${step}" aria-label="Increase ${label}">${mpIcon('plus', 16)}</button>
    </div>`;

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
        this.container.className = 'match-config-modal sb-mp-screen hidden';

        this.container.innerHTML = `
      <div class="match-config-overlay" aria-hidden="true"></div>
      <div class="sb-mp-sheet lmc" role="dialog" aria-modal="true"
           aria-labelledby="local-match-config-title" aria-describedby="local-match-config-lede">
        <div class="match-config-content sb-mp-sheet__panel">
          <header class="match-config-header sb-mp-sheet__header">
            <div class="sb-mp-sheet__heading">
              <p class="sb-eyebrow">Stack · Local versus</p>
              <h2 class="sb-mp-sheet__title" id="local-match-config-title">Local versus</h2>
              <p class="sb-mp-sheet__lede" id="local-match-config-lede">Up to four players on one screen — keyboards, controllers or bots.</p>
            </div>
            <button type="button" class="sb-mp-close" id="close-local-match-config" aria-label="Close and return to the menu">${mpIcon('close', 20)}</button>
          </header>

          <form id="local-match-config-form" class="match-config-form sb-mp-sheet__form" novalidate>
            <div class="lmc-body sb-mp-sheet__body">
              <section class="lmc-zone" aria-labelledby="lmc-players-label">
                <div class="lmc-zone__head">
                  <h3 class="sb-mp-label" id="lmc-players-label">Players</h3>
                  <select id="num-players" name="numPlayers" aria-label="Number of players">
                    <option value="2" selected>2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
                <div id="player-slot-cards" class="lmc-slot-grid"></div>
                <p class="sb-mp-help lmc-zone__note">Seats on the same team are allies — one colour, no attacks between them.</p>
              </section>

              <section class="lmc-zone" aria-labelledby="lmc-rules-label">
                <div class="lmc-zone__head">
                  <h3 class="sb-mp-label" id="lmc-rules-label">Rules</h3>
                </div>
                <div class="lmc-rules">
                  <div class="sb-mp-field" id="match-mode-group">
                    <span class="sb-mp-field__label" id="match-mode-label">Game mode</span>
                    <select id="match-mode" name="matchMode" aria-label="Game mode">
                      <option value="ffa" selected>Classic</option>
                      <option value="infinity-lms">Infinity</option>
                    </select>
                    <p class="sb-mp-help" id="match-mode-help"></p>
                  </div>

                  <div class="sb-mp-field" id="attack-style-group">
                    <span class="sb-mp-field__label" id="attack-style-label">Attacks</span>
                    <select id="attack-style" name="attackStyle" aria-label="Attacks">
                      <option value="standard" selected>Standard</option>
                      <option value="blind">Blind</option>
                      <option value="full_blind">Full blind</option>
                      <option value="hot_potato">Hot potato</option>
                      <option value="peaceful">Peaceful</option>
                    </select>
                    <p class="sb-mp-help" id="attack-style-help"></p>
                  </div>

                  <div class="sb-mp-field" id="end-condition-group">
                    <span class="sb-mp-field__label" id="end-condition-label">Win condition</span>
                    <select id="end-condition" name="endCondition" aria-label="Win condition">
                      <option value="frags" selected>Frags</option>
                      <option value="time">Time</option>
                      <option value="points">Score</option>
                      <option value="lines">Lines</option>
                      <option value="never">Endless</option>
                    </select>
                  </div>

                  <div class="sb-mp-field sb-mp-field--inline" id="end-value-group">
                    <div class="sb-mp-field__text">
                      <label class="sb-mp-field__label" for="end-condition-value" id="end-value-label">Frags to win</label>
                      <p class="sb-mp-help" id="end-value-help"></p>
                    </div>
                    ${stepper('end-condition-value', 'endConditionValue', {
        min: 1, max: 100, value: 7, label: 'the target',
    })}
                  </div>

                  <div class="sb-mp-field sb-mp-field--inline" id="infinity-rows-group" hidden>
                    <div class="sb-mp-field__text">
                      <label class="sb-mp-field__label" for="infinity-max-rows">Well height</label>
                      <p class="sb-mp-help">Rows in each well, from 100 to 1,000.</p>
                    </div>
                    ${stepper('infinity-max-rows', 'infinityMaxRows', {
        min: 100, max: 1000, value: 100, step: 50, label: 'the well height',
    })}
                  </div>
                </div>

                <details class="advanced-settings sb-mp-more">
                  <summary><span>More rules</span>${mpIcon('chevron', 16, 'sb-mp-more__chevron')}</summary>
                  <div class="sb-mp-more__body">
                    <div class="sb-mp-field sb-mp-field--inline form-group" id="start-level-group">
                      <div class="sb-mp-field__text">
                        <label class="sb-mp-field__label" for="start-level">Starting level</label>
                        <p class="sb-mp-help">Higher levels drop pieces faster.</p>
                      </div>
                      ${stepper('start-level', 'startLevel', {
        min: 1, max: 9, value: 1, label: 'the starting level',
    })}
                    </div>
                    <label class="sb-mp-switch form-group" id="level-progression-group">
                      <span class="sb-mp-field__text">
                        <span class="sb-mp-field__label">Level up as you clear</span>
                        <span class="sb-mp-help">One level for every 15 lines.</span>
                      </span>
                      <input type="checkbox" class="sb-toggle" id="level-progression" name="levelProgression" />
                    </label>
                    <label class="sb-mp-switch form-group" id="boring-rules-group">
                      <span class="sb-mp-field__text">
                        <span class="sb-mp-field__label">No attack scaling</span>
                        <span class="sb-mp-help">Attacks keep full strength with three or four players.</span>
                      </span>
                      <input type="checkbox" class="sb-toggle" id="boring-rules" name="boringRules" />
                    </label>
                  </div>
                </details>
              </section>
            </div>

            <footer class="lmc-footer form-actions sb-mp-sheet__footer">
              <p class="sb-mp-alert" id="local-match-error" role="alert" hidden></p>
              <ul class="sb-hints sb-mp-sheet__hints" aria-hidden="true">
                <li><kbd class="sb-kbd" data-key>Esc</kbd><kbd class="sb-kbd" data-pad>B</kbd>Back</li>
                <li><kbd class="sb-kbd" data-key>Enter</kbd><kbd class="sb-kbd" data-pad>A</kbd>Start</li>
              </ul>
              <div class="sb-mp-sheet__actions">
                <button type="button" class="sb-btn sb-btn--quiet" id="cancel-local-match">Back</button>
                <button type="submit" class="sb-btn sb-btn--primary" id="start-local-match">Start match</button>
              </div>
            </footer>
          </form>
        </div>
        <span class="sb-mp-sheet__key" aria-hidden="true"></span>
      </div>
    `;

        document.body.appendChild(this.container);
        this.setupEventListeners();
        // Enhance the static rule controls (seat-card controls are enhanced per render).
        this.enhanceStaticControls();
    }

    enhanceStaticControls() {
        ['#num-players', '#match-mode', '#end-condition', '#attack-style'].forEach((sel) => {
            const el = this.container.querySelector(sel);
            if (el) this._enhancers.push(enhanceSegmented(el));
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

        const form = this.container.querySelector('#local-match-config-form');
        form?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
        // Any edit clears a previous validation message.
        form?.addEventListener('input', () => this.clearError());
        form?.addEventListener('change', () => this.clearError());

        this.container.querySelector('#num-players')?.addEventListener('change', () => {
            this.renderSlotCards();
        });

        this.setupSteppers();
        this.setupScrollPerformanceMode();
    }

    /** −/+ buttons beside each number field; values clamp to the field's range. */
    setupSteppers() {
        this.container.querySelectorAll('.sb-stepper').forEach((wrap) => {
            const input = wrap.querySelector('input[type="number"]');
            if (!input) return;
            const range = () => ({
                min: parseInt(input.min, 10) || 0,
                max: parseInt(input.max, 10) || 0,
            });
            const clamp = (value) => {
                const { min, max } = range();
                return Math.min(max, Math.max(min, value));
            };
            wrap.querySelectorAll('[data-step]').forEach((button) => {
                button.addEventListener('click', () => {
                    const step = parseInt(button.dataset.step, 10) || 0;
                    const current = parseInt(input.value, 10);
                    input.value = String(clamp((Number.isFinite(current) ? current : range().min) + step));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });
            input.addEventListener('blur', () => {
                if (input.value === '') return;
                const parsed = parseInt(input.value, 10);
                input.value = String(clamp(Number.isFinite(parsed) ? parsed : range().min));
            });
        });
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
     * Render one seat card per player — human/bot, bot skill, handicap and team —
     * preserving prior selections across re-renders. Every <select> is enhanced.
     * @param {Object} [restore] saved values to prefer over the current ones
     */
    renderSlotCards(restore = null) {
        const grid = this.container.querySelector('#player-slot-cards');
        if (!grid) return;

        const numPlayers = this.getNumPlayers();
        grid.dataset.count = String(numPlayers);

        // Preserve current selections (read the native selects before clearing).
        const previous = {};
        grid.querySelectorAll('select').forEach((sel) => { previous[sel.name] = sel.value; });
        if (restore) Object.assign(previous, restore);

        // Retire the enhancers of the cards being replaced.
        this._enhancers = this._enhancers.filter((enhancer) => {
            if (enhancer?.element && grid.contains(enhancer.element)) return false;
            return true;
        });
        grid.innerHTML = '';

        for (let i = 1; i <= numPlayers; i++) {
            const kindName = `player${i}Kind`;
            const skillName = `player${i}BotDifficulty`;
            const handicapName = `player${i}Handicap`;
            const teamName = `player${i}Team`;
            const defaultKind = i === 2 ? 'bot' : 'human';
            const kindVal = previous[kindName] === 'bot' || previous[kindName] === 'human'
                ? previous[kindName]
                : defaultKind;

            // Resolve this seat's team: prior selection if still valid for the
            // current player count, else the player's own team (P_i -> Team i).
            let teamId = previous[teamName] !== undefined ? parseInt(previous[teamName], 10) : i - 1;
            if (!Number.isInteger(teamId) || teamId < 0 || teamId >= numPlayers) teamId = i - 1;

            const savedSkill = parseInt(previous[skillName], 10);
            const skill = savedSkill >= 1 && savedSkill <= BOT_SKILL_TIERS.length ? savedSkill : DEFAULT_BOT_SKILL;
            const savedHandicap = parseInt(previous[handicapName], 10);
            const handicap = savedHandicap >= 0 && savedHandicap <= 4 ? savedHandicap : 2;

            const card = document.createElement('div');
            card.className = 'lmc-slot';
            card.dataset.seat = String(i);
            card.dataset.hue = seatHue(teamId);

            const skillOptions = BOT_SKILL_TIERS.map((tierLabel, index) => {
                const tier = index + 1;
                return `<option value="${tier}" ${tier === skill ? 'selected' : ''}>${tier} · ${tierLabel}</option>`;
            }).join('');

            // Team options A..D, capped at the player count (no point offering a
            // team a player could never share). Default = the seat's own team.
            const teamOptions = Array.from({ length: numPlayers }, (_, t) => {
                const letter = String.fromCharCode(65 + t);
                return `<option value="${t}" ${t === teamId ? 'selected' : ''}>Team ${letter}</option>`;
            }).join('');

            const handicapOptions = ['Beginner', 'Apprentice', 'Intermediate', 'Master', 'Grandmaster']
                .map((label, value) => `<option value="${value}" ${value === handicap ? 'selected' : ''}>${label}</option>`)
                .join('');

            card.innerHTML = `
                <div class="lmc-slot__head">
                    <span class="lmc-slot__badge" aria-hidden="true">P${i}</span>
                    <span class="lmc-slot__name" id="lmc-seat-${i}-name">Player ${i}</span>
                    <span class="lmc-slot__kind-icon" aria-hidden="true"></span>
                </div>
                <select class="lmc-slot__kind" name="${kindName}" aria-label="Player ${i} plays as">
                    <option value="human" ${kindVal === 'human' ? 'selected' : ''}>Human</option>
                    <option value="bot" ${kindVal === 'bot' ? 'selected' : ''}>Bot</option>
                </select>
                <div class="sb-mp-field lmc-slot__skill">
                    <label class="sb-mp-field__label" for="${skillName}">Bot skill</label>
                    <select id="${skillName}" name="${skillName}">${skillOptions}</select>
                </div>
                <div class="sb-mp-field lmc-slot__handicap">
                    <label class="sb-mp-field__label" for="${handicapName}">Handicap</label>
                    <select id="${handicapName}" name="${handicapName}">${handicapOptions}</select>
                </div>
                <div class="sb-mp-field lmc-slot__team">
                    <label class="sb-mp-field__label" for="${teamName}">Team</label>
                    <select id="${teamName}" name="${teamName}">${teamOptions}</select>
                </div>
            `;
            card.setAttribute('role', 'group');
            card.setAttribute('aria-labelledby', `lmc-seat-${i}-name`);

            grid.appendChild(card);

            // Reflect bot/human state, then enhance every select on the card.
            const kindSelect = card.querySelector(`[name="${kindName}"]`);
            const skillSelect = card.querySelector(`[name="${skillName}"]`);
            const handicapSelect = card.querySelector(`[name="${handicapName}"]`);
            const nameEl = card.querySelector('.lmc-slot__name');
            const kindIcon = card.querySelector('.lmc-slot__kind-icon');
            const applyKind = () => {
                const isBot = kindSelect.value === 'bot';
                card.classList.toggle('is-bot', isBot);
                nameEl.textContent = isBot ? `Bot ${i}` : `Player ${i}`;
                kindIcon.innerHTML = mpIcon(isBot ? 'bot' : 'human', 18);
                skillSelect.disabled = !isBot;
                skillSelect._cosmicSelect?.syncDisabled();
            };
            kindSelect.addEventListener('change', applyKind);

            // Live-preview the team colour: two seats on one team share a hue, as
            // their boards, garbage and HUD will in play.
            const teamSelect = card.querySelector(`[name="${teamName}"]`);
            teamSelect.addEventListener('change', () => {
                card.dataset.hue = seatHue(parseInt(teamSelect.value, 10));
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

        const config = CONDITION_COPY[condition];
        if (!config) {
            console.warn(`Unknown end condition: ${condition}`);
            return;
        }

        if (condition === 'never') {
            valueGroup.hidden = true;
            return;
        }

        valueGroup.hidden = this.isInfinity();
        valueLabel.textContent = config.label;
        valueInput.min = config.min;
        valueInput.max = config.max;
        valueInput.value = config.defaultValue;
        valueInput.placeholder = String(config.defaultValue);
        valueHelp.textContent = config.help;
    }

    isInfinity() {
        return this.container.querySelector('#match-mode')?.value === 'infinity-lms';
    }

    refreshFormState() {
        const matchMode = this.container.querySelector('#match-mode');
        const modeHelp = this.container.querySelector('#match-mode-help');
        const endConditionGroup = this.container.querySelector('#end-condition-group');
        const endCondition = this.container.querySelector('#end-condition');
        const valueGroup = this.container.querySelector('#end-value-group');
        const infinityRowsGroup = this.container.querySelector('#infinity-rows-group');
        const startLevelGroup = this.container.querySelector('#start-level-group');
        const levelProgressionGroup = this.container.querySelector('#level-progression-group');
        if (!matchMode) return;

        const isInfinity = matchMode.value === 'infinity-lms';
        if (modeHelp) {
            modeHelp.textContent = isInfinity
                ? 'A well up to 1,000 rows tall. The last player standing wins.'
                : 'Win by frags, time, score or lines — you choose below.';
        }
        if (endConditionGroup) endConditionGroup.hidden = isInfinity;
        if (valueGroup) valueGroup.hidden = isInfinity || endCondition?.value === 'never';
        if (infinityRowsGroup) infinityRowsGroup.hidden = !isInfinity;
        if (startLevelGroup) startLevelGroup.hidden = isInfinity;
        if (levelProgressionGroup) levelProgressionGroup.hidden = isInfinity;
    }

    updateAttackStyleUI(style) {
        const help = this.container.querySelector('#attack-style-help');
        if (!help) return;
        help.textContent = ATTACK_HELP[style] || ATTACK_HELP.standard;
    }

    readFormValues() {
        const form = this.container.querySelector('#local-match-config-form');
        const values = {};
        if (form) new FormData(form).forEach((value, key) => { values[key] = value; });
        return values;
    }

    /** Re-apply a remembered setup, accepting only values the form can offer. */
    restoreSetup(saved) {
        if (!saved) return;
        const setSelect = (selector, value) => {
            const select = this.container.querySelector(selector);
            if (!select || value === undefined) return false;
            const allowed = Array.from(select.options).some((option) => option.value === String(value));
            if (!allowed || select.value === String(value)) return false;
            select.value = String(value);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        };
        const setNumber = (selector, value) => {
            const input = this.container.querySelector(selector);
            const parsed = parseInt(value, 10);
            if (!input || !Number.isFinite(parsed)) return;
            const min = parseInt(input.min, 10);
            const max = parseInt(input.max, 10);
            if (parsed >= min && parsed <= max) input.value = String(parsed);
        };

        setSelect('#num-players', saved.numPlayers);
        // Seat values: the re-render reads `restore` before falling back to defaults.
        const seats = {};
        Object.keys(saved).forEach((key) => {
            if (/^player[1-4](Kind|BotDifficulty|Handicap|Team)$/.test(key)) seats[key] = String(saved[key]);
        });
        this.renderSlotCards(seats);

        setSelect('#match-mode', saved.matchMode);
        setSelect('#attack-style', saved.attackStyle);
        setSelect('#end-condition', saved.endCondition);
        setNumber('#end-condition-value', saved.endConditionValue);
        setNumber('#infinity-max-rows', saved.infinityMaxRows);
        setNumber('#start-level', saved.startLevel);
        const progression = this.container.querySelector('#level-progression');
        if (progression) progression.checked = saved.levelProgression === 'on';
        const boring = this.container.querySelector('#boring-rules');
        if (boring) boring.checked = saved.boringRules === 'on';
    }

    showError(message, field = null) {
        const alert = this.container.querySelector('#local-match-error');
        if (alert) {
            alert.textContent = message;
            alert.hidden = false;
        }
        this.container.querySelector('.sb-mp-sheet__footer')?.classList.add('has-error');
        if (field) {
            field.setAttribute('aria-invalid', 'true');
            field.closest('details')?.setAttribute('open', '');
            field.focus({ preventScroll: false });
        }
    }

    clearError() {
        const alert = this.container?.querySelector('#local-match-error');
        if (!alert || alert.hidden) return;
        alert.hidden = true;
        alert.textContent = '';
        this.container.querySelector('.sb-mp-sheet__footer')?.classList.remove('has-error');
        this.container.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    }

    handleSubmit() {
        const form = this.container.querySelector('#local-match-config-form');
        if (!form) {
            console.error('[LocalMatchConfig] Form not found');
            return;
        }

        const values = this.readFormValues();
        const config = buildLocalMatchConfig(values);

        if (config.numPlayers < 2 || config.numPlayers > 4) {
            const seats = this.container.querySelector('#num-players')?.parentElement;
            this.showError('Choose two, three or four players.', seats?.querySelector('.is-checked'));
            return;
        }
        if (!config.isInfinityLMS) {
            if (config.startLevel < 1 || config.startLevel > 9) {
                this.showError('Choose a starting level from 1 to 9.', this.container.querySelector('#start-level'));
                return;
            }
            if (config.endCondition !== 'never' && config.endConditionValue <= 0) {
                const unit = CONDITION_COPY[config.endCondition]?.unit || 'points';
                this.showError(`Set how many ${unit} win the match.`, this.container.querySelector('#end-condition-value'));
                return;
            }
        }

        writeLastSetup(values);
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
        this.renderSlotCards();
        this.restoreSetup(readLastSetup());
        const attackStyle = this.container.querySelector('#attack-style');
        if (attackStyle) this.updateAttackStyleUI(attackStyle.value);
        this.refreshFormState();
        this.clearError();

        openLayer(this.container, () => this.cancel());
        // The remembered setup is usually the one to play: Start has focus.
        focusSoon(() => this.container?.querySelector('#start-local-match'));
        console.log('[LocalMatchConfig] Modal shown');
    }

    hide() {
        if (!this.container) return;
        closeLayer(this.container);
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
        if (this.container) closeLayer(this.container);
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
            this.container = null;
        }
    }
}
