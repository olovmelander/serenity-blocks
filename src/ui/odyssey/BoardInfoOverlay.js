/**
 * @fileoverview Odyssey board-view HUD overlay (header bar + chapter-arrival card + level panel).
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
            </div>
        </div>
        <div id="odyssey-chapter-arrival-card" class="odyssey-chapter-arrival-card" aria-live="polite">
            <div id="odyssey-arrival-kicker" class="odyssey-arrival-kicker">Chapter 1</div>
            <div id="odyssey-arrival-title" class="odyssey-arrival-title">Earth Core</div>
            <div id="odyssey-arrival-subtitle" class="odyssey-arrival-subtitle">Find your first rhythm</div>
        </div>
        <div id="odyssey-level-panel" class="odyssey-level-panel hidden">
            <span class="odyssey-level-panel__key" aria-hidden="true"></span>
            <div id="level-panel-number" class="level-number-badge">LEVEL 1</div>
            <h2 id="level-panel-name">Level Name</h2>
            <p id="level-panel-chapter" class="level-chapter">Chapter 1</p>
            <p id="level-panel-description" class="level-description">Description...</p>
            <div id="level-panel-stars" class="level-stars">☆☆☆</div>
            <div id="level-panel-objectives" class="level-objectives"></div>
            <label class="odyssey-flow-preference" for="odyssey-auto-continue">
                <input id="odyssey-auto-continue" type="checkbox" aria-describedby="odyssey-flow-preference-hint">
                <span class="odyssey-flow-preference__copy">
                    <span>Continue automatically within chapters</span>
                    <small id="odyssey-flow-preference-hint">Chapter reveals wait for you.</small>
                </span>
            </label>
            <button id="level-panel-play-btn" class="level-play-btn">Play</button>
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
