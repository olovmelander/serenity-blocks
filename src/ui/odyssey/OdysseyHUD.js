/**
 * @fileoverview Odyssey Mode HUD Component
 * Displays level objectives, progress, stars, and time during gameplay.
 */

import { getLevelById } from '../../core/odyssey/data/levels.js';
import { CHAPTER_CONFIGS } from '../../core/odyssey/data/chapters.js';
import { OdysseyOpponentBoard } from '../../rendering/phaser/odyssey-opponent-board.js';
import { updateNextQueue } from '../next-queue-ui.js';
import {
    formatOdysseyBonusObjective, formatOdysseyChainGoal, getOdysseyChainTarget, getOdysseyLevelGuide,
} from './objective-copy.js';

const setText = (element, value) => {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
};

/**
 * OdysseyHUD - Displays odyssey-specific statistics and objectives.
 */
export class OdysseyHUD {
    /**
     * Create HUD component.
     * @param {Object} options - Configuration options.
     */
    constructor(options = {}) {
        this.levelId = options.levelId || 1;
        this.levelConfig = null;
        this.chapterConfig = null;

        this.container = null;
        this.levelNameDisplay = null;
        this.chapterDisplay = null;
        this.objectiveDisplay = null;
        this.progressValue = null;
        this.progressBar = null;
        this.timeDisplay = null;
        this.starsDisplay = null;
        this.bonusesDisplay = null;
        this.finishHint = null;
        this.onFinish = options.onFinish;
        this.duel = null;
        this.duelPanel = null;
        this.opponentBoard = null;
        this.completedBonuses = new Set();

        this.isVisible = false;
        this.startTime = null;
        this.elapsedTime = 0;
        this.timeLimit = null;
        this.isPaused = false;
        this.isVictoryLap = false;

        this.metrics = {
            lines: 0,
            score: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            tetrises: 0,
            singles: 0,
            combo: 0,
            bonuses: 0,
            deaths: 0,
            frags: 0,
        };

        this.animationFrame = null;
        this._initialize();
    }

    _initialize() {
        this.container = document.createElement('div');
        this.container.id = 'odyssey-hud';
        this.container.className = 'odyssey-hud';
        this.container.role = 'region';
        this.container.ariaLabel = 'Level objective and progress';

        this._createHeaderSection();
        this._createObjectiveSection();
        this._createGuideSection();
        this._createProgressSection();
        this._createTimeSection();
        this._createStarsSection();
        this._createBonusesSection();
        this._createFinishHint();
        this._createPauseHint();

        console.log('[OdysseyHUD] Initialized');
    }

    _createHeaderSection() {
        const section = document.createElement('div');
        section.className = 'hud-section header-section';

        this.chapterDisplay = document.createElement('div');
        this.chapterDisplay.className = 'chapter-label';
        this.chapterDisplay.textContent = 'CHAPTER 1';
        section.appendChild(this.chapterDisplay);

        this.levelNameDisplay = document.createElement('div');
        this.levelNameDisplay.className = 'level-name';
        this.levelNameDisplay.textContent = 'First Light';
        section.appendChild(this.levelNameDisplay);

        this.levelBadge = document.createElement('div');
        this.levelBadge.className = 'level-badge';
        this.levelBadge.textContent = 'Level 1';
        section.appendChild(this.levelBadge);

        this.container.appendChild(section);
    }

    _createObjectiveSection() {
        const section = document.createElement('div');
        section.className = 'hud-section objective-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'OBJECTIVE';
        section.appendChild(label);

        this.objectiveDisplay = document.createElement('div');
        this.objectiveDisplay.className = 'objective-text';
        this.objectiveDisplay.textContent = 'Clear 40 lines';
        section.appendChild(this.objectiveDisplay);

        this.progressValue = document.createElement('div');
        this.progressValue.className = 'progress-value';
        this.progressValue.textContent = '0 / 40';
        section.appendChild(this.progressValue);

        this.container.appendChild(section);
    }

    _createProgressSection() {
        const section = document.createElement('div');
        section.className = 'hud-section progress-section';

        const barContainer = document.createElement('div');
        barContainer.className = 'progress-track';

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-fill';
        barContainer.role = 'progressbar';
        barContainer.ariaLabel = 'Level progress';
        barContainer.ariaValueMin = '0';
        this.progressTrack = barContainer;
        barContainer.appendChild(this.progressBar);

        section.appendChild(barContainer);
        this.container.appendChild(section);
    }

    _createTimeSection() {
        const section = document.createElement('div');
        section.className = 'hud-section time-section';

        this.timeLabel = document.createElement('div');
        this.timeLabel.className = 'hud-label';
        this.timeLabel.textContent = 'ELAPSED';
        section.appendChild(this.timeLabel);

        this.timeDisplay = document.createElement('div');
        this.timeDisplay.className = 'time-value';
        this.timeDisplay.textContent = '0:00';
        section.appendChild(this.timeDisplay);

        this.container.appendChild(section);
    }

    _createGuideSection() {
        this.guide = document.createElement('details');
        this.guide.className = 'hud-section level-guide';
        const summary = document.createElement('summary');
        summary.textContent = 'Level guide';
        this.guide.appendChild(summary);
        this.guideText = document.createElement('p');
        this.guide.appendChild(this.guideText);
        this.container.appendChild(this.guide);
    }

    _createStarsSection() {
        const section = document.createElement('div');
        section.className = 'hud-section stars-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'STAR GOALS';
        section.appendChild(label);

        this.starsDisplay = document.createElement('div');
        this.starsDisplay.className = 'stars-list';

        for (let i = 0; i < 3; i++) {
            const starRow = document.createElement('div');
            starRow.className = 'star-row';
            starRow.dataset.star = i + 1;

            const starIcon = document.createElement('div');
            starIcon.className = 'star-icon';
            starIcon.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" stroke-width="2"/>
                </svg>
            `;

            const reqText = document.createElement('div');
            reqText.className = 'star-requirement';
            reqText.textContent = '...';

            starRow.appendChild(starIcon);
            starRow.appendChild(reqText);
            this.starsDisplay.appendChild(starRow);
        }

        section.appendChild(this.starsDisplay);
        this.container.appendChild(section);
    }

    _createBonusesSection() {
        const section = document.createElement('div');
        section.className = 'hud-section bonuses-section';

        const label = document.createElement('div');
        label.className = 'hud-label';
        label.textContent = 'BONUS OBJECTIVES';
        section.appendChild(label);

        this.bonusesDisplay = document.createElement('div');
        this.bonusesDisplay.className = 'bonuses-list';
        section.appendChild(this.bonusesDisplay);

        this.bonusesSection = section;
        this.container.appendChild(section);
    }

    _createFinishHint() {
        this.finishHint = document.createElement('button');
        this.finishHint.type = 'button';
        this.finishHint.className = 'finish-hint sb-btn sb-btn--primary';
        this.finishHint.innerHTML = 'Finish level <kbd class="sb-kbd" data-key>Enter</kbd>';
        this.finishHint.addEventListener('click', () => {
            if (this.isVictoryLap) this.onFinish?.();
        });
        this.container.appendChild(this.finishHint);
    }

    _createPauseHint() {
        this.pauseHint = document.createElement('p');
        this.pauseHint.className = 'odyssey-pause-hint';
        this.pauseHint.innerHTML = '<kbd class="sb-kbd" data-key>Esc</kbd> Pause';
        this.container.appendChild(this.pauseHint);
    }

    /** Configure a bot duel without owning any gameplay rules or bot simulation. */
    setDuel({ targetFrags = 7, botName = 'Opponent', difficulty = 1 } = {}) {
        this.duel = { targetFrags: Math.max(1, Number(targetFrags) || 7), botName, difficulty };
        this.container.classList.add('is-duel');
        this.objectiveDisplay.textContent = `Beat ${botName} · First to ${this.duel.targetFrags} frags`;
        this.guideText.textContent = `Send garbage by clearing lines. Knock out ${botName} to earn a frag. `
            + 'Both boards reset after a knockout; the first to the goal wins.';
        this.guide.hidden = false;

        if (!this.duelScoreboard) {
            this.duelScoreboard = document.createElement('div');
            this.duelScoreboard.className = 'odyssey-duel-scoreboard';
            this.duelScoreboard.innerHTML = '<div><span>You</span><strong data-player-frags>0</strong></div>'
                + '<span class="odyssey-duel-score-divider" aria-hidden="true">:</span>'
                + '<div><span data-bot-name>Opponent</span><strong data-bot-frags>0</strong></div>';
            this.container.querySelector('.objective-section').appendChild(this.duelScoreboard);
            this.playerFragsDisplay = this.duelScoreboard.querySelector('[data-player-frags]');
            this.botFragsDisplay = this.duelScoreboard.querySelector('[data-bot-frags]');
            this.duelRoundDisplay = document.createElement('p');
            this.duelRoundDisplay.className = 'odyssey-duel-round';
            this.duelRoundDisplay.role = 'status';
            this.container.querySelector('.objective-section').appendChild(this.duelRoundDisplay);
            this.playerGarbageDisplay = document.createElement('p');
            this.playerGarbageDisplay.className = 'odyssey-duel-incoming';
            this.container.querySelector('.objective-section').appendChild(this.playerGarbageDisplay);
        }
        this.duelScoreboard.querySelector('[data-bot-name]').textContent = String(botName);
        if (!this.playerGarbageTrack) {
            this.playerGarbageTrack = document.createElement('div');
            this.playerGarbageTrack.id = 'odyssey-player-garbage';
            this.playerGarbageTrack.className = 'odyssey-duel-garbage';
            this.playerGarbageTrack.ariaHidden = 'true';
            this.playerGarbageTrack.hidden = true;
        }
        if (!this.duelPanel) {
            this.duelPanel = document.createElement('aside');
            this.duelPanel.id = 'odyssey-duel-opponent';
            this.duelPanel.className = 'odyssey-duel-opponent';
            this.duelPanel.ariaLabel = 'Opponent board';
            this.duelPanel.innerHTML = '<div class="odyssey-duel-opponent__plate">'
                + '<p class="odyssey-duel-opponent__label">OPPONENT</p>'
                + '<h2 class="odyssey-duel-opponent__name"></h2>'
                + '<p class="odyssey-duel-opponent__skill"></p></div>'
                + '<div id="odyssey-duel-next-queue" class="odyssey-duel-opponent__queue" '
                + 'aria-label="Next pieces"></div>'
                + '<div class="odyssey-duel-opponent__well">'
                + '<div class="odyssey-duel-opponent__garbage odyssey-duel-garbage" aria-hidden="true"></div>'
                + '<div class="odyssey-duel-opponent__phaser-host" role="img" '
                + 'aria-label="Live opponent board"></div></div>'
                + '<p class="odyssey-duel-opponent__next"></p>'
                + '<p class="odyssey-duel-incoming"></p>';
            this.botBoardHost = this.duelPanel.querySelector('.odyssey-duel-opponent__phaser-host');
            this.botGarbageTrack = this.duelPanel.querySelector('.odyssey-duel-opponent__garbage');
            this.botNextDisplay = this.duelPanel.querySelector('.odyssey-duel-opponent__next');
            this.botGarbageDisplay = this.duelPanel.querySelector('.odyssey-duel-incoming');
        }
        this.duelPanel.querySelector('.odyssey-duel-opponent__name').textContent = String(botName);
        this.duelPanel.ariaLabel = `${botName}'s board`;
        this.duelPanel.querySelector('.odyssey-duel-opponent__skill').textContent = `Bot skill ${difficulty}`;
        this.updateDuel({ playerFrags: 0, botFrags: 0, round: 1 });
        if (this.isVisible) this.show();
    }

    /** Prepare a canonical Phaser observer before the match becomes playable. */
    async prepareOpponentBoard(gameState, options = {}) {
        this.opponentBoard?.dispose();
        const observer = new OdysseyOpponentBoard(options);
        this.opponentBoard = observer;
        const ready = await observer.prepare(this.botBoardHost, gameState);
        if (!ready || this.opponentBoard !== observer) return null;
        observer.setPaused(this.isPaused);
        return observer;
    }

    getOpponentBoard() {
        return this.opponentBoard;
    }

    /** Publish plain duel numbers and board truth from the mode's runtime. */
    updateDuel({
        playerFrags = 0, botFrags = 0, deaths = botFrags, round = 1,
        playerPendingGarbage = 0, botPendingGarbage = 0,
        paused = this.isPaused, intermission = false, botGrid, botNextPieces,
    } = {}) {
        if (!this.duel) return;
        setText(this.playerFragsDisplay, playerFrags);
        setText(this.botFragsDisplay, botFrags);
        let roundText = `Round ${round}`;
        if (intermission) roundText += ' · Next round starting';
        if (paused) roundText = 'Paused · Both boards are held';
        setText(this.duelRoundDisplay, roundText);
        this.duelScoreboard.ariaLabel = `You ${playerFrags}, ${this.duel.botName} ${botFrags}. `
            + `First to ${this.duel.targetFrags}.`;
        setText(this.playerGarbageDisplay, `Incoming: ${playerPendingGarbage} lines`);
        setText(this.botGarbageDisplay, `Incoming: ${botPendingGarbage} lines`);
        this.playerGarbageDisplay.classList.toggle('has-garbage', playerPendingGarbage > 0);
        this.botGarbageDisplay.classList.toggle('has-garbage', botPendingGarbage > 0);
        if (botNextPieces) {
            setText(this.botNextDisplay, `Next: ${botNextPieces.slice(0, 3).join(' · ')}`);
            updateNextQueue(botNextPieces, 'odyssey-duel-next-queue');
        }
        [[this.playerGarbageTrack, playerPendingGarbage], [this.botGarbageTrack, botPendingGarbage]]
            .forEach(([track, lines]) => {
                if (!track) return;
                const fill = String(Math.min(1, Math.max(0, lines / 20)));
                if (track.style.getPropertyValue('--garbage-fill') !== fill) {
                    track.style.setProperty('--garbage-fill', fill);
                }
                const active = String(lines > 0);
                const heavy = String(lines >= 8);
                if (track.dataset.active !== active) track.dataset.active = active;
                if (track.dataset.heavy !== heavy) track.dataset.heavy = heavy;
            });
        if (Array.isArray(botGrid)) {
            const highestRow = botGrid.findIndex((row) => row.some(Boolean));
            const danger = highestRow >= 0 && (highestRow < 9
                || (this.duelPanel.dataset.danger === 'true' && highestRow < 12));
            if (this.duelPanel.dataset.danger !== String(danger)) this.duelPanel.dataset.danger = String(danger);
        }
        this.opponentBoard?.update();
        this.updateMetrics({ frags: playerFrags, deaths });
        this.setPaused(paused);
    }

    setPaused(paused) {
        const isPaused = Boolean(paused);
        if (this.isPaused === isPaused) return;
        this.isPaused = isPaused;
        this.container.classList.toggle('is-paused', this.isPaused);
        this.duelPanel?.classList.toggle('is-paused', this.isPaused);
        this.opponentBoard?.setPaused(this.isPaused);
        this.pauseHint.innerHTML = this.isPaused
            ? 'Paused · <kbd class="sb-kbd" data-key>Esc</kbd> Resume'
            : '<kbd class="sb-kbd" data-key>Esc</kbd> Pause';
    }

    /**
     * Set level and update display.
     * @param {number} levelId - Level ID to display.
     */
    setLevel(levelId) {
        this.levelId = levelId;
        this.levelConfig = getLevelById(levelId);

        if (!this.levelConfig) {
            console.error('[OdysseyHUD] Level not found:', levelId);
            return;
        }

        this.chapterConfig = CHAPTER_CONFIGS.find((c) => c.id === this.levelConfig.chapter);

        this.chapterDisplay.textContent = `CHAPTER ${this.levelConfig.chapter}`;
        this.levelNameDisplay.textContent = this.levelConfig.name;
        this.levelBadge.textContent = `Level ${levelId}`;
        this.guideText.textContent = getOdysseyLevelGuide(this.levelConfig);
        this.guide.hidden = !this.guideText.textContent;

        this._updateObjectiveDisplay();

        const { victory } = this.levelConfig;
        this.timeLimit = victory.failure && victory.failure.type === 'time'
            ? victory.failure.value
            : null;
        this.timeLabel.textContent = this.timeLimit ? 'TIME LEFT' : 'ELAPSED';

        this._updateBonusesDisplay();
        this._updateStarRequirements();
        this.resetMetrics();

        console.log('[OdysseyHUD] Level set:', levelId, this.levelConfig.name);
    }

    _updateStarRequirements() {
        if (!this.levelConfig?.stars) return;

        const { stars } = this.levelConfig;
        const starRows = this.starsDisplay.querySelectorAll('.star-row');
        const starConfigs = [stars.one, stars.two, stars.three];

        starRows.forEach((row, index) => {
            const reqText = row.querySelector('.star-requirement');
            if (reqText && starConfigs[index]) {
                reqText.textContent = this._formatStarCondition(starConfigs[index], index);
            }
        });
    }

    _formatStarCondition(condition, starIndex) {
        const parts = [];
        let hasChainRequirement = false;

        for (const [key, value] of Object.entries(condition)) {
            switch (key) {
            case 'lines':
                parts.push(starIndex === 0 ? 'Complete level' : `${value} lines`);
                break;
            case 'score':
                if (starIndex === 0) {
                    parts.push('Complete level');
                } else {
                    parts.push(`${value.toLocaleString()}+ pts`);
                }
                break;
            case 'cascades':
                if (starIndex === 0) {
                    parts.push('Complete level');
                } else {
                    parts.push(`${value}+ cascades`);
                }
                break;
            case 'time':
                if (value >= 60) {
                    const mins = Math.floor(value / 60);
                    const secs = value % 60;
                    parts.push(secs === 0 ? `Under ${mins} min` : `Under ${mins}:${secs.toString().padStart(2, '0')}`);
                } else {
                    parts.push(`Under ${value}s`);
                }
                break;
            case 'tetrises':
                parts.push(`${value}+ quads`);
                break;
            case 'maxCascadeDepth':
            case 'combo':
                if (!hasChainRequirement) {
                    parts.push(`${getOdysseyChainTarget(condition)}-wave chain`);
                    hasChainRequirement = true;
                }
                break;
            case 'bonuses':
                parts.push(value === 1 ? 'Get bonus' : `${value} bonuses`);
                break;
            case 'frags':
                parts.push(`Win ${value} frags`);
                break;
            case 'maxDeaths':
                parts.push(value === 0 ? 'No top-outs' : `At most ${value} top-out${value === 1 ? '' : 's'}`);
                break;
            default:
                break;
            }
        }

        if (parts.length === 0 && starIndex === 0) {
            parts.push('Complete level');
        }

        return parts.join(' + ') || '...';
    }

    _updateObjectiveDisplay() {
        if (!this.levelConfig) return;

        const { type, target } = this.levelConfig.victory.primary;
        let objectiveText = '';

        switch (type) {
        case 'lines':
            objectiveText = `Clear ${target} lines`;
            break;
        case 'score':
            objectiveText = `Score ${target.toLocaleString()} points`;
            break;
        case 'cascade':
            objectiveText = `Trigger ${target} cascades`;
            break;
        case 'combo':
            objectiveText = formatOdysseyChainGoal(target);
            break;
        case 'tetrises':
            objectiveText = `Clear ${target} quads`;
            break;
        case 'time':
            objectiveText = `Survive ${target} seconds`;
            break;
        case 'height':
            objectiveText = `Build to ${target} rows`;
            break;
        case 'frags':
            objectiveText = `Beat the bot · First to ${target} frags`;
            break;
        default:
            objectiveText = 'Complete the objective';
        }

        this.objectiveDisplay.textContent = objectiveText;
        this.progressValue.textContent = `0 / ${target}`;
        this.progressTrack.ariaValueMax = String(target);
        this.progressTrack.ariaValueNow = '0';
    }

    _updateBonusesDisplay() {
        if (!this.levelConfig) return;

        this.bonusesDisplay.innerHTML = '';

        const { bonuses } = this.levelConfig.victory;
        this.bonusesSection.hidden = !bonuses?.length;
        if (!bonuses || bonuses.length === 0) {
            const noneText = document.createElement('div');
            noneText.className = 'bonus-empty';
            noneText.textContent = 'No bonus objectives';
            this.bonusesDisplay.appendChild(noneText);
            return;
        }

        bonuses.forEach((bonus, index) => {
            const bonusItem = document.createElement('div');
            bonusItem.className = 'bonus-item';
            bonusItem.dataset.index = index;

            const checkbox = document.createElement('div');
            checkbox.className = 'bonus-checkbox';
            bonusItem.appendChild(checkbox);

            const text = document.createElement('span');
            text.textContent = formatOdysseyBonusObjective(bonus);
            bonusItem.appendChild(text);

            this.bonusesDisplay.appendChild(bonusItem);
        });
    }

    /**
     * Update metrics from game state.
     * @param {Object} metrics - Current game metrics.
     */
    updateMetrics(metrics) {
        Object.assign(this.metrics, metrics);
        if (Array.isArray(metrics.bonusResults)) {
            this.completedBonuses.clear();
            metrics.bonusResults.forEach((complete, index) => {
                if (complete) this.completedBonuses.add(index);
                const item = this.bonusesDisplay.querySelector(`[data-index="${index}"]`);
                item?.classList.toggle('is-complete', Boolean(complete));
            });
            this.metrics.bonuses = this.completedBonuses.size;
        }
        this._updateProgress();
        this._checkStars();
    }

    _updateProgress() {
        if (!this.levelConfig || this.isVictoryLap) return;

        const { type, target } = this.levelConfig.victory.primary;
        let current = 0;

        switch (type) {
        case 'lines':
            current = this.metrics.lines;
            break;
        case 'score':
            current = this.metrics.score;
            break;
        case 'cascade':
            current = this.metrics.cascades;
            break;
        case 'combo':
            current = this.metrics.combo || 0;
            break;
        case 'tetrises':
            current = this.metrics.tetrises || 0;
            break;
        case 'time':
            current = Math.floor(this.elapsedTime / 1000);
            break;
        case 'height':
            current = this.metrics.height || 0;
            break;
        case 'frags':
            current = this.metrics.frags || 0;
            break;
        default:
            break;
        }

        setText(this.progressValue, type === 'score'
            ? `${current.toLocaleString()} / ${target.toLocaleString()}`
            : `${current} / ${target}`);

        const percentage = Math.min(100, (current / target) * 100);
        const width = `${percentage}%`;
        if (this.progressBar.style.width !== width) this.progressBar.style.width = width;
        this.progressBar.classList.toggle('is-complete', percentage >= 100);
        this.progressTrack.ariaValueNow = String(Math.min(target, current));
    }

    _checkStars() {
        if (!this.levelConfig) return;

        const { stars } = this.levelConfig;
        let earnedStars = 0;

        if (this._meetsCondition(stars.one)) earnedStars = 1;
        if (this._meetsCondition(stars.two)) earnedStars = 2;
        if (this._meetsCondition(stars.three)) earnedStars = 3;

        this._updateStars(earnedStars);
    }

    _meetsCondition(condition) {
        if (!condition) return false;
        for (const [key, value] of Object.entries(condition)) {
            switch (key) {
            case 'lines':
                if (this.metrics.lines < value) return false;
                break;
            case 'score':
                if (this.metrics.score < value) return false;
                break;
            case 'cascades':
                if (this.metrics.cascades < value) return false;
                break;
            case 'maxCascadeDepth':
                if (this.metrics.maxCascadeDepth < value) return false;
                break;
            case 'tetrises':
                if (this.metrics.tetrises < value) return false;
                break;
            case 'combo':
                if (this.metrics.combo < value) return false;
                break;
            case 'time':
                if (this.elapsedTime / 1000 > value) return false;
                break;
            case 'bonuses':
                if (this.metrics.bonuses < value) return false;
                break;
            case 'frags':
                if (this.metrics.frags < value) return false;
                break;
            case 'maxDeaths':
                if (this.metrics.deaths > value) return false;
                break;
            default:
                return false;
            }
        }
        return true;
    }

    _updateStars(earnedStars) {
        const starRows = this.starsDisplay.querySelectorAll('.star-row');
        starRows.forEach((row, index) => {
            row.classList.toggle('earned', index + 1 <= earnedStars);
        });
    }

    /**
     * Update time display.
     * @param {number} elapsed - Elapsed time in milliseconds.
     */
    updateTime(elapsed) {
        this.elapsedTime = Math.max(0, Number(elapsed) || 0);

        if (this.timeLimit) {
            const remaining = Math.max(0, this.timeLimit * 1000 - this.elapsedTime);
            const minutes = Math.floor(remaining / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            setText(this.timeDisplay, `${minutes}:${seconds.toString().padStart(2, '0')}`);
            this.timeDisplay.classList.toggle('is-danger', remaining < 30000);
            this.timeDisplay.classList.toggle('is-warning', remaining >= 30000 && remaining < 60000);
        } else {
            const minutes = Math.floor(this.elapsedTime / 60000);
            const seconds = Math.floor((this.elapsedTime % 60000) / 1000);
            setText(this.timeDisplay, `${minutes}:${seconds.toString().padStart(2, '0')}`);
            this.timeDisplay.classList.remove('is-danger', 'is-warning');
        }
        this._updateProgress();
        this._checkStars();
    }

    /**
     * Mark a bonus as complete.
     * @param {number} index - Bonus index.
     */
    completeBons(index) {
        this.completeBonus(index);
    }

    /**
     * Mark a bonus as complete.
     * @param {number} index - Bonus index.
     */
    completeBonus(index) {
        const bonusItem = this.bonusesDisplay.querySelector(`[data-index="${index}"]`);
        if (!bonusItem) return;

        const checkbox = bonusItem.querySelector('.bonus-checkbox');
        if (checkbox) {
            checkbox.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M20 6L9 17L4 12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
                </svg>
            `;
        }
        bonusItem.classList.add('is-complete');
        this.completedBonuses.add(index);
        this.metrics.bonuses = this.completedBonuses.size;
        this._checkStars();
    }

    /**
     * Enter victory lap mode.
     */
    enterVictoryLap() {
        this.isVictoryLap = true;
        this.container.classList.add('is-victory-lap');

        if (this.objectiveDisplay) {
            this.objectiveDisplay.textContent = 'Goal complete · Keep playing for more stars';
        }
        if (this.progressBar) {
            this.progressBar.style.width = '100%';
            this.progressBar.classList.add('is-complete');
        }
        if (this.progressValue) {
            this.progressValue.textContent = 'Complete';
        }

        this._showFinishHint();
        console.log('[OdysseyHUD] Victory lap mode activated');
    }

    /**
     * Exit victory lap mode.
     */
    exitVictoryLap() {
        this.isVictoryLap = false;
        this.container.classList.remove('is-victory-lap');
        this._hideFinishHint();
        this._updateObjectiveDisplay();
        this._updateProgress();

        console.log('[OdysseyHUD] Victory lap mode deactivated');
    }

    _showFinishHint() {
        this.finishHint?.classList.add('is-visible');
    }

    _hideFinishHint() {
        this.finishHint?.classList.remove('is-visible');
    }

    /**
     * Reset all metrics.
     */
    resetMetrics() {
        this.metrics = {
            lines: 0,
            score: 0,
            cascades: 0,
            maxCascadeDepth: 0,
            tetrises: 0,
            singles: 0,
            combo: 0,
            bonuses: 0,
            deaths: 0,
            frags: 0,
        };
        this.completedBonuses.clear();
        this.elapsedTime = 0;
        this.isVictoryLap = false;
        this.container.classList.remove('is-victory-lap');
        this.progressBar.classList.remove('is-complete');
        this.progressBar.style.width = '0%';
        this._updateProgress();
        this._updateStars(0);
        this.updateTime(0);
        this._hideFinishHint();
    }

    /**
     * Show HUD.
     */
    show() {
        const stage = document.querySelector('.single-player-stage');

        if (stage && this.container.parentElement !== stage) {
            stage.appendChild(this.container);
        }
        if (stage && this.duelPanel && this.duelPanel.parentElement !== stage) {
            stage.appendChild(this.duelPanel);
        }
        if (this.playerGarbageTrack) {
            const well = stage?.querySelector('#single-player-container .player-board-section');
            if (well && this.playerGarbageTrack.parentElement !== well) well.appendChild(this.playerGarbageTrack);
            this.playerGarbageTrack.hidden = false;
        }

        this.container.classList.add('is-visible');
        this.duelPanel?.classList.add('is-visible');
        this.opponentBoard?.setPaused(this.isPaused);
        this.isVisible = true;
        console.log('[OdysseyHUD] Shown');
    }

    /**
     * Hide HUD.
     */
    hide() {
        this.container.classList.remove('is-visible');
        this.duelPanel?.classList.remove('is-visible');
        if (this.playerGarbageTrack) this.playerGarbageTrack.hidden = true;
        this.opponentBoard?.setPaused(true);
        this.isVisible = false;
        console.log('[OdysseyHUD] Hidden');
    }

    /**
     * Get current level configuration.
     * @returns {Object|null}
     */
    getLevelConfig() {
        return this.levelConfig;
    }

    /**
     * Get current metrics.
     * @returns {Object}
     */
    getMetrics() {
        return { ...this.metrics, elapsedTime: this.elapsedTime };
    }

    /**
     * Destroy HUD and clean up.
     */
    destroy() {
        this.opponentBoard?.dispose();
        this.opponentBoard = null;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }

        if (this.container && this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }
        this.duelPanel?.remove();
        this.duelPanel = null;
        this.playerGarbageTrack?.remove();
        this.playerGarbageTrack = null;

        console.log('[OdysseyHUD] Destroyed');
    }
}
