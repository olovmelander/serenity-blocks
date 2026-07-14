/**
 * @fileoverview Odyssey level-failed modal (Retry / Back to Map).
 *
 * Extracted verbatim from OdysseyMode._createFailureModal (masterplan E1). Pure DOM/view: it takes
 * the failure reason text + the attempt number + a single-fire choice callback, and returns the
 * modal element. The caller owns removing the modal (a retry keeps the dark backdrop up while the
 * board resets), so this never removes itself — it only detaches its own keydown listener on choice.
 */

/**
 * Build the "Level Failed" modal.
 * @param {object} deps
 * @param {string} deps.reasonText human-readable failure reason ("Time ran out!" / "You topped out!")
 * @param {function('retry'|'map'):void} deps.onChoose single-fire; fired by button or keyboard
 * @param {?number} deps.attemptNumber current attempt (shows an "Attempt N" line when finite)
 * @param {boolean} [deps.includeLegacyResults=true] whether this attempt is persisted
 * @returns {HTMLElement} the modal root element (caller mounts + later removes it)
 */
export function createFailureModal({
    reasonText,
    onChoose,
    attemptNumber,
    includeLegacyResults = true,
}) {
    const modal = document.createElement('div');
    modal.id = 'odyssey-failure-modal';
    modal.dataset.odysseyWheelLock = 'true';
    modal.style.cssText = `
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        animation: fadeIn 0.3s ease-out;
    `;

    // Add keyframes
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    `;
    modal.appendChild(style);

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(165deg, rgba(40, 15, 20, 0.95) 0%, rgba(30, 10, 15, 0.98) 100%);
        border: 1px solid rgba(255, 100, 100, 0.4);
        border-radius: 24px;
        padding: 40px 50px;
        text-align: center;
        max-width: 400px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6), 0 0 80px rgba(255, 80, 80, 0.2);
        animation: slideUp 0.4s ease-out;
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
    `;

    // Title
    const title = document.createElement('h2');
    title.textContent = 'Level Failed';
    title.style.cssText = `
        margin: 0 0 15px 0;
        font-size: 28px;
        font-weight: 700;
        color: rgba(255, 100, 100, 1);
        text-shadow: 0 0 30px rgba(255, 80, 80, 0.5);
    `;
    content.appendChild(title);

    // Reason
    const reason = document.createElement('div');
    reason.textContent = reasonText;
    reason.style.cssText = `
        font-size: 16px;
        color: rgba(255, 200, 200, 0.8);
        margin-bottom: 8px;
    `;
    content.appendChild(reason);

    if (!includeLegacyResults) {
        const unrankedNotice = document.createElement('div');
        unrankedNotice.className = 'odyssey-failure-unranked';
        unrankedNotice.textContent = 'Experimental Session · Unranked — this attempt was not recorded.';
        unrankedNotice.style.cssText = `
            margin: 12px 0 20px;
            font-size: 11px;
            line-height: 1.5;
            color: rgba(220, 190, 255, 0.72);
        `;
        content.appendChild(unrankedNotice);
    }

    // Attempt counter (builds the "one more try" momentum)
    if (Number.isFinite(attemptNumber)) {
        const attempt = document.createElement('div');
        attempt.textContent = `Attempt ${attemptNumber}`;
        attempt.style.cssText = `
            font-size: 12px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: rgba(255, 200, 200, 0.45);
            margin-bottom: 28px;
        `;
        content.appendChild(attempt);
    }

    // Actions: Retry (primary) + Back to Map (secondary)
    const actions = document.createElement('div');
    actions.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 12px;
    `;

    const retryBtn = document.createElement('button');
    retryBtn.textContent = 'Retry';
    retryBtn.style.cssText = `
        padding: 14px 40px;
        font-size: 16px;
        font-weight: 600;
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
        color: #fff;
        background: linear-gradient(135deg, rgba(255, 100, 100, 0.35) 0%, rgba(255, 150, 100, 0.35) 100%);
        border: 1px solid rgba(255, 120, 110, 0.7);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    retryBtn.onmouseenter = () => {
        retryBtn.style.background = 'linear-gradient(135deg, rgba(255, 100, 100, 0.55) 0%, rgba(255, 150, 100, 0.55) 100%)';
        retryBtn.style.transform = 'scale(1.05)';
    };
    retryBtn.onmouseleave = () => {
        retryBtn.style.background = 'linear-gradient(135deg, rgba(255, 100, 100, 0.35) 0%, rgba(255, 150, 100, 0.35) 100%)';
        retryBtn.style.transform = 'scale(1)';
    };

    const mapBtn = document.createElement('button');
    mapBtn.textContent = 'Back to Map';
    mapBtn.style.cssText = `
        padding: 11px 40px;
        font-size: 14px;
        font-weight: 500;
        font-family: 'Orbitron', 'Segoe UI', sans-serif;
        color: rgba(255, 220, 220, 0.75);
        background: transparent;
        border: 1px solid rgba(255, 120, 110, 0.3);
        border-radius: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
    `;
    mapBtn.onmouseenter = () => {
        mapBtn.style.background = 'rgba(255, 120, 110, 0.12)';
        mapBtn.style.color = '#fff';
    };
    mapBtn.onmouseleave = () => {
        mapBtn.style.background = 'transparent';
        mapBtn.style.color = 'rgba(255, 220, 220, 0.75)';
    };

    actions.appendChild(retryBtn);
    actions.appendChild(mapBtn);
    content.appendChild(actions);

    // Keyboard hints
    const hints = document.createElement('div');
    hints.style.cssText = `
        margin-top: 20px;
        font-size: 11px;
        letter-spacing: 0.5px;
        color: rgba(255, 200, 200, 0.4);
    `;
    hints.innerHTML = 'Press <b style="color: rgba(255,200,200,0.7);">Enter</b> / <b style="color: rgba(255,200,200,0.7);">R</b> to retry &middot; <b style="color: rgba(255,200,200,0.7);">Esc</b> for map';
    content.appendChild(hints);

    modal.appendChild(content);

    // Single-fire choice dispatch shared by buttons + keyboard. The caller owns
    // removing the modal (a retry keeps the backdrop up while the board resets).
    let resolved = false;
    let onKeyDown = null;
    const choose = (choice) => {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKeyDown, true);
        onChoose(choice);
    };
    onKeyDown = (e) => {
        switch (e.key) {
        case 'Enter':
        case ' ':
        case 'r':
        case 'R':
            e.preventDefault();
            e.stopPropagation();
            choose('retry');
            break;
        case 'Escape':
            e.preventDefault();
            e.stopPropagation();
            choose('map');
            break;
        default:
            break;
        }
    };
    // Capture phase so the modal wins over any still-attached gameplay key handlers.
    document.addEventListener('keydown', onKeyDown, true);

    retryBtn.addEventListener('click', () => choose('retry'));
    mapBtn.addEventListener('click', () => choose('map'));

    return modal;
}

export default createFailureModal;
