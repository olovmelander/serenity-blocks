/**
 * @fileoverview Odyssey legacy level-select navigator scaffold (header + chapters host + back).
 *
 * Extracted from OdysseyMode._createLevelSelectUI (masterplan E1). Builds the static shell
 * (header/progress bar, empty #odyssey-chapters host, back button), mounts it, and returns the
 * container. Styles: public/styles/keystone-overlays.css. The DATA (chapters/levels/progress) is populated
 * separately by OdysseyMode._updateLevelSelectUI, and the back-button handler (which needs
 * mode state) is wired by the caller — so this module stays view-only + dependency-free.
 */

/**
 * Build + mount the level-select shell.
 * @returns {HTMLElement} the container (caller wires #odyssey-back-btn and populates chapters)
 */
export function createLevelSelectOverlay() {
    const container = document.createElement('div');
    container.id = 'odyssey-level-select';
    container.className = 'odyssey-level-select';
    container.innerHTML = `
        <div class="odyssey-header">
            <p class="sb-eyebrow">Ascend · The journey</p>
            <h1><img class="odyssey-header-wordmark" src="./assets/branding/modes/odyssey.svg" alt="Odyssey" width="628" height="104"></h1>
            <div class="odyssey-progress">
                <span class="odyssey-stars"><b><span id="odyssey-total-stars">0</span> / <span id="odyssey-max-stars">0</span></b> Stars</span>
                <span class="odyssey-completion"><b><span id="odyssey-progress-pct">0</span>%</b> Journey</span>
            </div>
            <div class="odyssey-progress-bar"><div class="odyssey-progress-fill" id="odyssey-progress-fill"></div></div>
        </div>
        <div class="odyssey-chapters" id="odyssey-chapters"></div>
        <div class="odyssey-actions">
            <button id="odyssey-back-btn" class="odyssey-btn">Back to menu</button>
        </div>
    `;

    // The look lives in public/styles/keystone-overlays.css (#odyssey-level-select).
    document.body.appendChild(container);

    return container;
}

export default createLevelSelectOverlay;
