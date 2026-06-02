/**
 * @fileoverview Infinity Mode HUD Component
 * Displays height, build statistics, and milestone achievements.
 *
 * Visual language: Cosmic Serenity (violet glass). Accents are pulled from the
 * shared tokens in public/styles/cosmic-tokens.css via var() — they resolve inside
 * inline styles too. Semantics: VIOLET = brand/current, GOLD = records/summit,
 * TEAL = live progress. (Note: this HUD is built with inline styles, so it can't be
 * re-skinned from a CSS layer — the container BACKGROUND is additionally forced by a
 * `!important` rule in main.css `.infinity-mode-active #infinity-hud`, kept in sync.)
 */

import { calculateTopRow, calculateBuildHeight } from '../../core/infinity-grid.js';

// ---- Cosmic Serenity palette (token-backed) -------------------------------------
const C = {
    violet: 'var(--cs-lavender)',
    violetRgb: 'var(--cs-lavender-rgb)',
    gold: 'var(--cs-gold)',
    goldRgb: 'var(--cs-gold-rgb)',
    teal: 'var(--cs-teal)',
    tealRgb: 'var(--cs-teal-rgb)',
    ink: 'var(--cs-ink)',
    label: 'rgba(196, 181, 253, 0.62)', // violet-grey muted label
    hairline: 'rgba(167, 139, 250, 0.16)',
};

/**
 * InfinityHUD - Displays infinity-specific statistics and progress
 *
 * Features:
 * - Current height from bottom (in rows)
 * - Top row position (distance from ceiling)
 * - Build height as percentage of max (1000 rows)
 * - Height milestones achieved
 * - Session statistics (blocks placed, combos, etc.)
 */
export class InfinityHUD {
    /**
     * Create HUD component
     */
    constructor() {
        // DOM elements
        this.container = null;
        this.heightDisplay = null;
        this.rowUnit = null;
        this.topRowDisplay = null;
        this.progressBar = null;
        this.milestonesDisplay = null;
        this.statsDisplay = null;
        this.cascadeCounter = null;

        // Game state reference
        this.gameState = null;

        // Milestones tracking
        this.milestones = [100, 250, 500, 750, 1000];
        this.achievedMilestones = new Set();

        // Cascade tracking
        this.activeCascadeCount = 0;
        this.cascadeTimeout = null;

        // PERFORMANCE: Cache values to avoid expensive recalculation
        // Only update DOM when values actually change
        this.lastBuildHeight = null;
        this.lastTopRow = null;
        this.lastPercentage = null;
        this.lastLockedPiecesCount = 0;
        this.lastStats = null;

        // PERFORMANCE: Cache individual stat values to avoid unnecessary DOM updates
        this.lastScore = null;
        this.lastBlocks = null;
        this.lastLines = null;
        this.lastMaxCascadeScore = null;

        // Initialize
        this._initialize();
    }

    /**
     * Initialize HUD
     * @private
     */
    _initialize() {
        // Inject shared keyframes once (milestone pulses + cascade counter)
        this._injectKeyframes();

        // Create main container — Cosmic Serenity violet glass
        this.container = document.createElement('div');
        this.container.id = 'infinity-hud';
        this.container.className = 'infinity-hud';
        this.container.style.cssText = `
            position: relative;
            width: clamp(210px, 18vw, 290px);
            background:
                radial-gradient(120% 50% at 50% -10%, rgba(${C.violetRgb}, 0.14), transparent 60%),
                linear-gradient(180deg, rgba(19, 18, 32, 0.92) 0%, rgba(10, 9, 18, 0.95) 100%);
            border: 1px solid rgba(${C.violetRgb}, 0.26);
            border-radius: 22px;
            padding: clamp(16px, 2vw, 24px);
            margin: 0;
            box-shadow:
                0 18px 50px rgba(0, 0, 0, 0.5),
                0 0 0 1px rgba(255, 255, 255, 0.04) inset,
                0 1px 0 rgba(255, 255, 255, 0.06) inset,
                0 0 70px rgba(${C.violetRgb}, 0.10);
            backdrop-filter: blur(14px) saturate(135%);
            -webkit-backdrop-filter: blur(14px) saturate(135%);
            font-family: 'Orbitron', 'Segoe UI', sans-serif;
            color: #fff;
            display: none;
            box-sizing: border-box;
            overflow: hidden;
        `;

        // Faint top sheen (replaces the old diagonal cyan glow)
        const glowOverlay = document.createElement('div');
        glowOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 40%;
            border-radius: 22px 22px 0 0;
            background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), transparent 70%);
            pointer-events: none;
            z-index: 0;
        `;
        this.container.appendChild(glowOverlay);

        // Create title with refined styling
        const title = document.createElement('div');
        title.className = 'hud-title';
        title.textContent = '∞ INFINITY';
        title.style.cssText = `
            position: relative;
            z-index: 1;
            font-size: clamp(11px, 1.2vw, 14px);
            font-weight: 700;
            text-align: center;
            margin-bottom: clamp(12px, 1.5vw, 20px);
            color: ${C.violet};
            letter-spacing: 4px;
            text-shadow: 0 0 20px rgba(${C.violetRgb}, 0.45);
            text-transform: uppercase;
        `;
        this.container.appendChild(title);

        // Create height section
        this._createHeightSection();

        // Create progress bar
        this._createProgressBar();

        // Create milestones section
        this._createMilestonesSection();

        // Create stats section
        this._createStatsSection();

        // Create live cascade counter overlay
        this._createCascadeCounter();

        console.log('[InfinityHUD] Initialized');
    }

    /**
     * Shared section-wrapper styling helper
     * @private
     */
    _sectionCss(withDivider = true) {
        return `
            position: relative;
            z-index: 1;
            margin-bottom: clamp(12px, 1.5vw, 18px);
            padding-bottom: clamp(10px, 1.2vw, 14px);
            ${withDivider ? `border-bottom: 1px solid ${C.hairline};` : ''}
        `;
    }

    /**
     * Shared section-label styling helper
     * @private
     */
    _labelCss(color = C.label) {
        return `
            font-family: 'Space Mono', monospace;
            font-size: clamp(8px, 0.8vw, 10px);
            color: ${color};
            margin-bottom: 8px;
            letter-spacing: 1.8px;
            text-transform: uppercase;
        `;
    }

    /**
     * Create height display section
     * @private
     */
    _createHeightSection() {
        const section = document.createElement('div');
        section.className = 'hud-section height-section';
        section.style.cssText = this._sectionCss();

        // Build height (primary stat)
        const heightLabel = document.createElement('div');
        heightLabel.textContent = 'BUILD HEIGHT';
        heightLabel.style.cssText = this._labelCss();
        heightLabel.style.marginBottom = '4px';
        section.appendChild(heightLabel);

        // Hero number + unit on one baseline (number only — no duplicated unit)
        const heightRow = document.createElement('div');
        heightRow.style.cssText = `
            display: flex;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 12px;
        `;

        this.heightDisplay = document.createElement('div');
        this.heightDisplay.className = 'height-value';
        this.heightDisplay.textContent = '0';
        this.heightDisplay.style.cssText = `
            font-size: clamp(30px, 3.2vw, 40px);
            font-weight: 800;
            color: #fff;
            line-height: 1;
            text-shadow: 0 0 26px rgba(${C.violetRgb}, 0.55);
        `;
        heightRow.appendChild(this.heightDisplay);

        // Row unit label (singular/plural set dynamically — was "1 ROWS" + dup "rows")
        this.rowUnit = document.createElement('div');
        this.rowUnit.textContent = 'ROWS';
        this.rowUnit.style.cssText = `
            font-family: 'Space Mono', monospace;
            font-size: clamp(9px, 0.9vw, 11px);
            color: rgba(${C.violetRgb}, 0.7);
            letter-spacing: 1.5px;
        `;
        heightRow.appendChild(this.rowUnit);
        section.appendChild(heightRow);

        // Distance to ceiling (the summit — GOLD)
        const ceilingContainer = document.createElement('div');
        ceilingContainer.style.cssText = `
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
        `;

        const topRowLabel = document.createElement('div');
        topRowLabel.textContent = 'TO CEILING';
        topRowLabel.style.cssText = `
            font-family: 'Space Mono', monospace;
            font-size: clamp(7px, 0.7vw, 9px);
            color: rgba(${C.goldRgb}, 0.7);
            letter-spacing: 1.2px;
            text-transform: uppercase;
        `;
        ceilingContainer.appendChild(topRowLabel);

        this.topRowDisplay = document.createElement('div');
        this.topRowDisplay.className = 'top-row-value';
        this.topRowDisplay.textContent = '—';
        this.topRowDisplay.style.cssText = `
            font-family: 'Space Mono', monospace;
            font-size: clamp(13px, 1.3vw, 16px);
            font-weight: 700;
            color: ${C.gold};
            text-shadow: 0 0 16px rgba(${C.goldRgb}, 0.35);
        `;
        ceilingContainer.appendChild(this.topRowDisplay);

        section.appendChild(ceilingContainer);
        this.container.appendChild(section);
    }

    /**
     * Create progress bar
     * @private
     */
    _createProgressBar() {
        const section = document.createElement('div');
        section.className = 'hud-section progress-section';
        section.style.cssText = this._sectionCss();

        // Header row with label and percentage
        const headerRow = document.createElement('div');
        headerRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        `;

        const label = document.createElement('div');
        label.textContent = 'PROGRESS';
        label.style.cssText = this._labelCss();
        label.style.marginBottom = '0';
        headerRow.appendChild(label);

        this.progressText = document.createElement('div');
        this.progressText.textContent = '0%';
        this.progressText.style.cssText = `
            font-family: 'Space Mono', monospace;
            font-size: clamp(12px, 1.2vw, 15px);
            font-weight: 700;
            color: ${C.teal};
            text-shadow: 0 0 14px rgba(${C.tealRgb}, 0.4);
        `;
        headerRow.appendChild(this.progressText);
        section.appendChild(headerRow);

        // Progress bar container
        const barContainer = document.createElement('div');
        barContainer.style.cssText = `
            width: 100%;
            height: 10px;
            background: rgba(0, 0, 0, 0.32);
            border: 1px solid rgba(${C.violetRgb}, 0.14);
            border-radius: 6px;
            overflow: hidden;
            position: relative;
            box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
        `;

        this.progressBar = document.createElement('div');
        this.progressBar.className = 'progress-fill';
        this.progressBar.style.cssText = `
            height: 100%;
            width: 0%;
            background: linear-gradient(90deg, ${C.violet} 0%, ${C.teal} 100%);
            border-radius: 6px;
            transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            box-shadow: 0 0 12px rgba(${C.violetRgb}, 0.55);
        `;
        barContainer.appendChild(this.progressBar);

        section.appendChild(barContainer);
        this.container.appendChild(section);
    }

    /**
     * Create milestones section
     * @private
     */
    _createMilestonesSection() {
        const section = document.createElement('div');
        section.className = 'hud-section milestones-section';
        section.style.cssText = this._sectionCss();

        const label = document.createElement('div');
        label.textContent = 'MILESTONES';
        label.style.cssText = this._labelCss();
        label.style.marginBottom = '10px';
        section.appendChild(label);

        this.milestonesDisplay = document.createElement('div');
        this.milestonesDisplay.className = 'milestones-list';
        this.milestonesDisplay.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        `;

        // Create milestone badges — start in the "future/locked" state
        this.milestones.forEach((milestone) => {
            const badge = document.createElement('div');
            badge.className = 'milestone-badge';
            badge.dataset.milestone = milestone;
            badge.textContent = milestone;
            badge.style.cssText = this._milestoneCss('future');
            this.milestonesDisplay.appendChild(badge);
        });

        section.appendChild(this.milestonesDisplay);
        this.container.appendChild(section);
    }

    /**
     * Milestone badge styling per state: 'future' | 'next' | 'passed'
     * @private
     */
    _milestoneCss(state) {
        const base = `
            padding: 4px 11px;
            border-radius: 999px;
            font-family: 'Space Mono', monospace;
            font-size: clamp(9px, 0.9vw, 11px);
            font-weight: 700;
            letter-spacing: 0.5px;
            transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        `;
        if (state === 'passed') {
            return `${base}
                background: rgba(${C.goldRgb}, 0.16);
                border: 1px solid rgba(${C.goldRgb}, 0.55);
                color: ${C.gold};
                box-shadow: 0 0 12px rgba(${C.goldRgb}, 0.28);
            `;
        }
        if (state === 'next') {
            return `${base}
                background: rgba(${C.violetRgb}, 0.20);
                border: 1px solid rgba(${C.violetRgb}, 0.70);
                color: #f3f0ff;
                box-shadow: 0 0 14px rgba(${C.violetRgb}, 0.40);
                animation: milestone-next-pulse 1.8s ease-in-out infinite;
            `;
        }
        // future / locked
        return `${base}
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.12);
            color: rgba(220, 227, 250, 0.40);
        `;
    }

    /**
     * Create statistics section
     * @private
     */
    _createStatsSection() {
        const section = document.createElement('div');
        section.className = 'hud-section stats-section';
        section.style.cssText = this._sectionCss(false);

        const label = document.createElement('div');
        label.textContent = 'SESSION STATS';
        label.style.cssText = this._labelCss();
        label.style.marginBottom = '10px';
        section.appendChild(label);

        this.statsDisplay = document.createElement('div');
        this.statsDisplay.className = 'stats-list';
        this.statsDisplay.style.cssText = `
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 9px 12px;
            font-size: clamp(10px, 1vw, 12px);
        `;

        const cellLabel = `font-family: 'Space Mono', monospace; font-size: 0.78em; color: ${C.label}; text-transform: uppercase; letter-spacing: 0.6px;`;
        const cellValue = `font-family: 'Space Mono', monospace; font-weight: 700; color: ${C.ink};`;
        const goldLabel = `font-family: 'Space Mono', monospace; font-size: 0.78em; color: rgba(${C.goldRgb}, 0.7); text-transform: uppercase; letter-spacing: 0.6px;`;
        const goldValue = `font-family: 'Space Mono', monospace; font-weight: 700; color: ${C.gold}; text-shadow: 0 0 14px rgba(${C.goldRgb}, 0.30);`;

        this.statsDisplay.innerHTML = `
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${cellLabel}">Blocks</span>
                <span id="stat-blocks" style="${cellValue} font-size: 1.2em;">0</span>
            </div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${cellLabel}">Lines</span>
                <span id="stat-lines" style="${cellValue} font-size: 1.2em;">0</span>
            </div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px; grid-column: span 2;">
                <span style="${cellLabel}">Score</span>
                <span id="stat-score" style="font-family: 'Space Mono', monospace; font-size: 1.5em; font-weight: 700; color: ${C.violet}; text-shadow: 0 0 16px rgba(${C.violetRgb}, 0.45);">0</span>
            </div>
            <div style="grid-column: span 2; height: 1px; background: ${C.hairline}; margin: 4px 0;"></div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${goldLabel}">Best Score</span>
                <span id="stat-max-cascade-score" style="${goldValue} font-size: 1.2em;">0</span>
            </div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${goldLabel}">Best Lines</span>
                <span id="stat-max-lines" style="${goldValue} font-size: 1.2em;">0</span>
            </div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${goldLabel}">Best Chain</span>
                <span id="stat-max-cascade" style="${goldValue} font-size: 1.2em;">0</span>
            </div>
            <div class="stat-item" style="display: flex; flex-direction: column; gap: 2px;">
                <span style="${goldLabel}">Total Cascades</span>
                <span id="stat-total-cascades" style="${goldValue} font-size: 1.2em;">0</span>
            </div>
        `;

        section.appendChild(this.statsDisplay);
        this.container.appendChild(section);
    }

    /**
     * Inject shared keyframes (milestone pulses + cascade counter) once.
     * @private
     */
    _injectKeyframes() {
        if (document.getElementById('infinity-hud-keyframes')) return;
        const style = document.createElement('style');
        style.id = 'infinity-hud-keyframes';
        style.textContent = `
            @keyframes milestone-pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.3); }
                100% { transform: scale(1); }
            }
            @keyframes milestone-next-pulse {
                0%, 100% { box-shadow: 0 0 10px rgba(167, 139, 250, 0.30); }
                50%      { box-shadow: 0 0 18px rgba(167, 139, 250, 0.55); }
            }
            @keyframes cascade-pulse {
                0% { transform: translate(-50%, -50%) scale(0.95); }
                100% { transform: translate(-50%, -50%) scale(1.05); }
            }
        `;
        document.head.appendChild(style);
    }

    /**
     * Create live cascade counter overlay
     * @private
     */
    _createCascadeCounter() {
        this.cascadeCounter = document.createElement('div');
        this.cascadeCounter.className = 'cascade-counter-overlay';
        this.cascadeCounter.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            padding: 24px 40px;
            font-family: 'Orbitron', monospace;
            font-size: 48px;
            font-weight: 900;
            color: #ffffff;
            text-shadow:
                0 0 20px rgba(${C.goldRgb}, 1.0),
                0 0 44px rgba(${C.violetRgb}, 0.75),
                2px 2px 4px rgba(0, 0, 0, 0.8);
            z-index: 10000;
            pointer-events: none;
            display: none;
            letter-spacing: 4px;
            animation: cascade-pulse 0.5s ease-in-out infinite alternate;
        `;

        document.body.appendChild(this.cascadeCounter);
    }

    /**
     * Update cascade counter display
     * @param {number} cascadeCount - Current cascade count
     */
    updateCascadeCounter(cascadeCount) {
        if (!this.cascadeCounter) return;

        this.activeCascadeCount = cascadeCount;

        // Only show for cascades 2+
        if (cascadeCount >= 2) {
            this.cascadeCounter.textContent = `CASCADE x${cascadeCount}`;
            this.cascadeCounter.style.display = 'block';

            // Update font size based on cascade count
            if (cascadeCount >= 20) {
                this.cascadeCounter.style.fontSize = '56px';
            } else if (cascadeCount >= 10) {
                this.cascadeCounter.style.fontSize = '52px';
            } else if (cascadeCount >= 5) {
                this.cascadeCounter.style.fontSize = '48px';
            } else {
                this.cascadeCounter.style.fontSize = '48px';
            }

            // Clear existing timeout
            if (this.cascadeTimeout) {
                clearTimeout(this.cascadeTimeout);
            }

            // Hide after 1.5 seconds of no updates
            this.cascadeTimeout = setTimeout(() => {
                this.hideCascadeCounter();
            }, 1500);
        }
    }

    /**
     * Hide cascade counter
     */
    hideCascadeCounter() {
        if (this.cascadeCounter) {
            this.cascadeCounter.style.display = 'none';
            this.activeCascadeCount = 0;
        }
    }

    /**
     * Show HUD
     */
    show() {
        const panel = document.getElementById('single-player-container');

        if (panel && this.container.parentElement !== panel) {
            panel.appendChild(this.container);
        }

        this.container.style.display = 'block';
        console.log('[InfinityHUD] Shown');
    }

    /**
     * Hide HUD
     */
    hide() {
        this.container.style.display = 'none';
        console.log('[InfinityHUD] Hidden');
    }

    /**
     * Update HUD with current game state
     * PERFORMANCE OPTIMIZED: Only updates DOM when values actually change
     * @param {Object} gameState - Current game state
     */
    update(gameState) {
        if (!gameState) return;
        this.gameState = gameState;

        // PERFORMANCE: Calculate current values once
        const buildHeight = calculateBuildHeight(this.gameState);
        const topRow = calculateTopRow(this.gameState);
        const lockedPiecesCount = this.gameState.lockedPieces?.length || 0;

        // PERFORMANCE: Only update height displays if values changed
        if (this.lastBuildHeight !== buildHeight || this.lastTopRow !== topRow) {
            // Update all height-related displays together
            this._updateHeightDisplays(buildHeight);
            this._updateProgressBar(buildHeight);
            this._updateMilestones(buildHeight);

            // Cache values AFTER updates
            this.lastBuildHeight = buildHeight;
            this.lastTopRow = topRow;
        }

        // PERFORMANCE: Only update statistics when piece count changes
        if (this.lastLockedPiecesCount !== lockedPiecesCount) {
            this.lastLockedPiecesCount = lockedPiecesCount;
            this._updateStatistics();
        }
    }

    /**
     * Update height displays
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateHeightDisplays(buildHeight) {
        const maxRows = this.gameState.maxRows || 1000;

        // Build height from bottom — number only; unit lives in the sublabel
        this.heightDisplay.textContent = buildHeight.toLocaleString();
        if (this.rowUnit) {
            this.rowUnit.textContent = buildHeight === 1 ? 'ROW' : 'ROWS';
        }

        // Rows remaining to reach the ceiling
        const rowsRemaining = Math.max(0, maxRows - buildHeight);
        const unit = rowsRemaining === 1 ? 'ROW' : 'ROWS';
        this.topRowDisplay.textContent = `${rowsRemaining.toLocaleString()} ${unit}`;
    }

    /**
     * Update progress bar
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateProgressBar(buildHeight) {
        const maxRows = this.gameState.maxRows || 1000;
        const percentage = (buildHeight / maxRows) * 100;

        this.progressBar.style.width = `${percentage}%`;
        this.progressText.textContent = `${percentage.toFixed(1)}%`;

        // Shift toward GOLD as the summit nears (live=violet→teal, then →gold near top)
        if (percentage >= 75) {
            this.progressBar.style.background = `linear-gradient(90deg, ${C.teal} 0%, ${C.gold} 100%)`;
            this.progressBar.style.boxShadow = `0 0 14px rgba(${C.goldRgb}, 0.55)`;
        } else if (percentage >= 40) {
            this.progressBar.style.background = `linear-gradient(90deg, ${C.violet} 0%, ${C.teal} 100%)`;
            this.progressBar.style.boxShadow = `0 0 12px rgba(${C.tealRgb}, 0.50)`;
        } else {
            this.progressBar.style.background = `linear-gradient(90deg, ${C.violet} 0%, ${C.teal} 100%)`;
            this.progressBar.style.boxShadow = `0 0 12px rgba(${C.violetRgb}, 0.55)`;
        }
    }

    /**
     * Update milestone badges (future / next-target / passed)
     * PERFORMANCE: Accepts pre-calculated buildHeight to avoid recalculation
     * @private
     * @param {number} buildHeight - Pre-calculated build height
     */
    _updateMilestones(buildHeight) {
        // The next target = the first milestone still ahead of us
        const nextMilestone = this.milestones.find((m) => buildHeight < m);

        this.milestones.forEach((milestone) => {
            const badge = this.milestonesDisplay.querySelector(`[data-milestone="${milestone}"]`);
            if (!badge) return;

            if (buildHeight >= milestone) {
                // Milestone achieved. Set the style FIRST, then the one-shot pulse —
                // otherwise cssText would wipe the animation we just set.
                const newlyAchieved = !this.achievedMilestones.has(milestone);
                badge.style.cssText = this._milestoneCss('passed');
                if (newlyAchieved) {
                    this.achievedMilestones.add(milestone);
                    this._animateMilestoneAchieved(badge);
                }
            } else if (milestone === nextMilestone) {
                badge.style.cssText = this._milestoneCss('next');
            } else {
                badge.style.cssText = this._milestoneCss('future');
            }
        });
    }

    /**
     * Animate milestone achievement
     * @private
     */
    _animateMilestoneAchieved(badge) {
        // Pulse animation (keyframes injected in _injectKeyframes)
        badge.style.animation = 'milestone-pulse 0.6s ease-out';
        console.log('[InfinityHUD] Milestone achieved:', badge.dataset.milestone);
    }

    /**
     * Update statistics display
     * PERFORMANCE OPTIMIZED: Only updates DOM when values actually change
     * @private
     */
    _updateStatistics() {
        // PERFORMANCE: Only update blocks if changed
        const blocksElem = document.getElementById('stat-blocks');
        if (blocksElem && this.gameState.infinityStats) {
            const blocks = this.gameState.infinityStats.blocksPlaced;
            if (this.lastBlocks !== blocks) {
                this.lastBlocks = blocks;
                blocksElem.textContent = blocks.toString();
            }
        }

        // PERFORMANCE: Only update lines if changed
        const linesElem = document.getElementById('stat-lines');
        if (linesElem) {
            const { lines } = this.gameState;
            if (this.lastLines !== lines) {
                this.lastLines = lines;
                linesElem.textContent = lines.toString();
            }
        }

        // PERFORMANCE CRITICAL: Only call toLocaleString() if score changed
        // toLocaleString() gets slower as numbers grow!
        const scoreElem = document.getElementById('stat-score');
        if (scoreElem) {
            const { score } = this.gameState;
            if (this.lastScore !== score) {
                this.lastScore = score;
                scoreElem.textContent = score.toLocaleString();
            }
        }

        // Update max cascade score (best score from a single cascade)
        const maxCascadeScoreElem = document.getElementById('stat-max-cascade-score');
        if (maxCascadeScoreElem && this.gameState.infinityStats) {
            const maxCascadeScore = this.gameState.infinityStats.maxCascadeScore || 0;
            if (this.lastMaxCascadeScore !== maxCascadeScore) {
                this.lastMaxCascadeScore = maxCascadeScore;
                maxCascadeScoreElem.textContent = maxCascadeScore.toLocaleString();
            }
        }

        // Update max cascade (cascade complexity / best chain depth)
        const maxCascadeElem = document.getElementById('stat-max-cascade');
        if (maxCascadeElem && this.gameState.infinityStats) {
            maxCascadeElem.textContent = this.gameState.infinityStats.maxComboComplexity.toString();
        }

        // Update max lines in cascade (best lines from one piece)
        const maxLinesElem = document.getElementById('stat-max-lines');
        if (maxLinesElem && this.gameState.infinityStats) {
            maxLinesElem.textContent = this.gameState.infinityStats.maxComboDepth.toString();
        }

        // Update total cascades (how many chain reactions 2+ triggered)
        const totalCascadesElem = document.getElementById('stat-total-cascades');
        if (totalCascadesElem && this.gameState.infinityStats) {
            totalCascadesElem.textContent = this.gameState.infinityStats.totalCascades.toString();
        }
    }

    /**
     * Destroy HUD and clean up
     */
    destroy() {
        // Clear cascade timeout
        if (this.cascadeTimeout) {
            clearTimeout(this.cascadeTimeout);
        }

        // Remove cascade counter from DOM
        if (this.cascadeCounter && this.cascadeCounter.parentElement) {
            this.cascadeCounter.parentElement.removeChild(this.cascadeCounter);
        }

        // Remove from DOM
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        // Remove injected keyframes
        const keyframes = document.getElementById('infinity-hud-keyframes');
        if (keyframes) {
            keyframes.remove();
        }

        console.log('[InfinityHUD] Destroyed');
    }
}
