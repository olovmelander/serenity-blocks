/**
 * @fileoverview Odyssey board-view HUD overlay (header bar + chapter-arrival card + orb panel).
 *
 * The orb panel's ids are filled by ui/odyssey/odyssey-level-panel.js (renderOdysseyLevelPanel).
 * The header's charm chip is a button: it opens the charm guide (odyssey-charm-guide.js, wired by
 * odyssey-map-input.js).
 *
 * Extracted from OdysseyMode._createBoardInfoOverlay (masterplan E1). Pure DOM: it builds and
 * returns the overlay + an (empty) <style> element. OdysseyMode keeps the wiring (mounting,
 * header-progress refresh, and the play-button → launchOdysseyLevel handler) since those need
 * mode state — so this module stays dependency-free and view-only.
 */

/**
 * Build the board-view HUD overlay.
 * @param {object} [options]
 * @param {boolean} [options.autoContinue=true] Continue between orbs in the same chapter.
 * @param {function(boolean):void} [options.onAutoContinueChange] Persist the player's choice.
 * @returns {{overlay: HTMLElement, style: HTMLStyleElement}} the overlay + its style element
 *   (caller appends both, wires the #level-panel-play-btn, and refreshes header progress)
 */
export function createBoardInfoOverlay({ autoContinue = true, onAutoContinueChange } = {}) {
    const overlay = document.createElement('div');
    overlay.id = 'odyssey-board-overlay';
    overlay.innerHTML = `
        <div class="odyssey-header-bar">
            <h1><img class="odyssey-header-wordmark" src="./assets/branding/modes/odyssey.svg" alt="Odyssey" width="628" height="104"></h1>
            <div class="odyssey-progress-info">
                <span id="odyssey-header-stars">★ 0</span>
                <span id="odyssey-header-progress">Progress: 0%</span>
                <button type="button" id="odyssey-header-charms" aria-haspopup="dialog" title="Clearing an orb leaves you a charm. Press 1–4 during an orb to use one.">◇ No charms yet</button>
            </div>
        </div>
        <div id="odyssey-chapter-arrival-card" class="odyssey-chapter-arrival-card" aria-live="polite">
            <div id="odyssey-arrival-kicker" class="odyssey-arrival-kicker">Chapter 1</div>
            <div id="odyssey-arrival-title" class="odyssey-arrival-title">Earth Core</div>
            <div id="odyssey-arrival-subtitle" class="odyssey-arrival-subtitle">Find your first rhythm</div>
        </div>
        <div id="odyssey-level-panel" class="odyssey-level-panel hidden">
            <div id="level-panel-number" class="level-number-badge">Orb 1</div>
            <p id="level-panel-kind" class="level-kind" hidden></p>
            <h2 id="level-panel-name">Orb</h2>
            <p id="level-panel-chapter" class="level-chapter">Chapter 1</p>
            <p id="level-panel-description" class="level-description"></p>
            <div id="level-panel-stars" class="level-stars" role="img" aria-label="0 of 3 stars earned">☆☆☆</div>
            <p id="level-panel-charm-hint" class="level-charm-hint" hidden></p>
            <div id="level-panel-objectives" class="level-objectives">
                <p class="level-goal"><strong>Goal</strong> <span id="level-panel-goal"></span></p>
                <p id="level-panel-star-goals-label" class="level-objectives__label">Star goals</p>
                <ul id="level-panel-star-goals" class="level-star-goals"></ul>
                <p id="level-panel-rules-label" class="level-objectives__label" hidden>Rules</p>
                <ul id="level-panel-rules" class="level-rules" hidden></ul>
                <p id="level-panel-tip" class="level-tip" hidden></p>
            </div>
            <p id="level-panel-lock" class="level-lock-hint" hidden></p>
            <label class="odyssey-flow-preference" for="odyssey-auto-continue">
                <input id="odyssey-auto-continue" type="checkbox" aria-describedby="odyssey-flow-preference-hint">
                <span class="odyssey-flow-preference__copy">
                    <span>Flow to the next orb automatically</span>
                    <small id="odyssey-flow-preference-hint">Chapter arrivals always wait for you.</small>
                </span>
            </label>
            <button id="level-panel-play-btn" class="level-play-btn">Play</button>
            <p class="level-nav-hint" aria-hidden="true"><kbd class="sb-kbd">←</kbd><kbd class="sb-kbd">→</kbd> orbs · <kbd class="sb-kbd">↑</kbd><kbd class="sb-kbd">↓</kbd> chapters · <kbd class="sb-kbd">Enter</kbd> play</p>
        </div>
    `;

    const autoContinueInput = overlay.querySelector('#odyssey-auto-continue');
    if (autoContinueInput) {
        autoContinueInput.checked = autoContinue !== false;
        autoContinueInput.addEventListener('change', () => {
            onAutoContinueChange?.(autoContinueInput.checked);
        });
    }

    // The look lives in public/styles/keystone-overlays.css (#odyssey-board-overlay). The
    // element is still returned because the caller mounts and later removes it by id.
    const style = document.createElement('style');
    style.id = 'odyssey-board-overlay-styles';
    return { overlay, style };
}

export default createBoardInfoOverlay;
