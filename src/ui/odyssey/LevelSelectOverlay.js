/**
 * @fileoverview The Odyssey navigator's shell: the journey header, the chapter rail (the
 * ascent, read from the bottom up), the stage that holds the selected orb's card and its
 * chapter's route, and the footer with the ways out and the input hints.
 *
 * Extracted from OdysseyMode._createLevelSelectUI (masterplan E1). Builds the static shell,
 * mounts it and returns the container; odyssey-navigator-list.js fills and runs it, and the
 * caller wires #odyssey-back-btn and the new-journey confirmation (odyssey-new-journey.js).
 * Styles: public/styles/odyssey-navigator.css (#odyssey-level-select).
 */

/** A keycap, and the controller button that does the same where there is one. */
function key(label, pad) {
    const padCap = pad ? `<kbd class="sb-kbd" data-pad>${pad}</kbd>` : '';
    return `<kbd class="sb-kbd" data-key>${label}</kbd>${padCap}`;
}

/** A header figure: the count, out of the whole, and what it counts. */
function stat(className, countId, wholeId, label) {
    return `<span class="${className}"><b><span id="${countId}">0</span>`
        + `<small> / <span id="${wholeId}">0</span></small></b> ${label}</span>`;
}

const LOCK_GLYPH = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/>'
    + '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';

/**
 * Build + mount the level-select shell.
 * @returns {HTMLElement} the container
 */
export function createLevelSelectOverlay() {
    const container = document.createElement('div');
    container.id = 'odyssey-level-select';
    container.className = 'odyssey-level-select';
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'odyssey-nav-title');
    container.innerHTML = `
        <div class="odyssey-nav__sky" aria-hidden="true">
            <img class="odyssey-nav__ambient" alt="" decoding="async" hidden>
        </div>
        <header class="odyssey-header">
            <div class="odyssey-header__brand">
                <p class="sb-eyebrow">Ascend · Chapters</p>
                <h1 id="odyssey-nav-title"><img class="odyssey-header-wordmark"
                    src="./assets/branding/modes/odyssey.svg" alt="Odyssey" width="628" height="104"></h1>
            </div>
            <div class="odyssey-header__journey">
                <div class="odyssey-progress">
                    ${stat('odyssey-stars', 'odyssey-total-stars', 'odyssey-max-stars', 'Stars')}
                    ${stat('odyssey-orbs', 'odyssey-cleared-orbs', 'odyssey-total-orbs', 'Orbs cleared')}
                    ${stat('odyssey-completion', 'odyssey-complete-chapters', 'odyssey-total-chapters', 'Chapters complete')}
                </div>
                <div class="odyssey-journey-meter" id="odyssey-journey-meter" aria-hidden="true"></div>
            </div>
            <button type="button" class="sb-btn odyssey-nav__close" data-navigator-action="close">
                Back to the map ${key('Esc', 'B')}
            </button>
        </header>
        <div class="odyssey-nav__body">
            <nav class="odyssey-nav__rail" aria-label="Chapters">
                <p class="sb-eyebrow sb-eyebrow--quiet odyssey-nav__rail-label">The ascent</p>
                <ol class="odyssey-chapters" id="odyssey-chapters" role="tablist" aria-orientation="vertical"></ol>
            </nav>
            <section class="odyssey-nav__stage" id="odyssey-nav-stage" role="tabpanel">
                <header class="odyssey-stage__chapter">
                    <div class="odyssey-stage__chapter-copy">
                        <p class="sb-eyebrow odyssey-stage__eyebrow" id="odyssey-stage-eyebrow"></p>
                        <h2 class="odyssey-stage__title" id="odyssey-stage-title"></h2>
                        <p class="odyssey-stage__intro" id="odyssey-stage-intro"></p>
                    </div>
                    <div class="odyssey-stage__chapter-side">
                        <span class="odyssey-stage__tally" id="odyssey-stage-tally"></span>
                        <div class="odyssey-stage__steps">
                            <button type="button" class="odyssey-stage__step" data-navigator-step="-1"
                                aria-label="Previous chapter">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>
                            </button>
                            <button type="button" class="odyssey-stage__step" data-navigator-step="1"
                                aria-label="Next chapter">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>
                            </button>
                        </div>
                    </div>
                </header>
                <article class="odyssey-postcard" id="odyssey-postcard" aria-labelledby="odyssey-postcard-title">
                    <div class="odyssey-postcard__art" aria-hidden="true">
                        <span class="odyssey-postcard__halo"></span>
                        <span class="odyssey-postcard__orbit"></span>
                        <img class="odyssey-postcard__image" alt="" width="512" height="512" decoding="async">
                        <span class="odyssey-postcard__lock">${LOCK_GLYPH}</span>
                    </div>
                    <div class="odyssey-postcard__copy">
                        <p class="sb-eyebrow odyssey-postcard__eyebrow" id="odyssey-postcard-eyebrow"></p>
                        <h3 class="odyssey-postcard__title" id="odyssey-postcard-title"></h3>
                        <p class="odyssey-postcard__stars" id="odyssey-postcard-stars"></p>
                        <p class="odyssey-postcard__description" id="odyssey-postcard-description"></p>
                        <p class="odyssey-postcard__lock-note" id="odyssey-postcard-lock" hidden></p>
                        <div class="odyssey-postcard__actions">
                            <button type="button" class="sb-btn sb-btn--primary" data-navigator-action="play">
                                <span class="odyssey-postcard__play-label">Play</span> ${key('Enter', 'A')}
                            </button>
                            <button type="button" class="sb-btn sb-btn--quiet" data-navigator-action="show">
                                Show on the map
                            </button>
                        </div>
                    </div>
                    <dl class="odyssey-postcard__facts">
                        <div class="odyssey-postcard__fact">
                            <dt>Goal</dt>
                            <dd id="odyssey-postcard-goal"></dd>
                        </div>
                        <div class="odyssey-postcard__fact" id="odyssey-postcard-star-goals-fact">
                            <dt>Stars</dt>
                            <dd><ul class="odyssey-postcard__star-goals" id="odyssey-postcard-star-goals"></ul></dd>
                        </div>
                        <div class="odyssey-postcard__fact" id="odyssey-postcard-best-fact" hidden>
                            <dt>Your best</dt>
                            <dd id="odyssey-postcard-best"></dd>
                        </div>
                        <div class="odyssey-postcard__fact" id="odyssey-postcard-reward-fact" hidden>
                            <dt id="odyssey-postcard-reward-label">Reward</dt>
                            <dd id="odyssey-postcard-reward"></dd>
                        </div>
                    </dl>
                </article>
                <ol class="odyssey-levels odyssey-route" id="odyssey-route" aria-label="Orbs in this chapter"></ol>
            </section>
        </div>
        <footer class="odyssey-actions">
            <div class="odyssey-actions__buttons">
                <button id="odyssey-back-btn" class="odyssey-btn">Main menu</button>
                <button id="odyssey-new-journey-btn" class="odyssey-btn odyssey-btn--quiet"
                    aria-expanded="false" aria-controls="odyssey-new-journey-confirm">Start a new journey</button>
            </div>
            <ul class="sb-hints odyssey-actions__hints">
                <li>${key('←', '◀')}${key('→', '▶')}Orb</li>
                <li>${key('↑', 'LB')}${key('↓', 'RB')}Chapter</li>
                <li>${key('Enter', 'A')}Play</li>
                <li>${key('Esc', 'B')}Map</li>
            </ul>
            <div id="odyssey-new-journey-confirm" class="odyssey-new-journey" role="group"
                aria-label="Start a new journey" hidden>
                <p class="odyssey-new-journey__copy">This erases your orbs, stars and charms and begins again at
                    Orb 1. Themes you have earned stay yours.</p>
                <div class="odyssey-new-journey__actions">
                    <button id="odyssey-new-journey-confirm-btn"
                        class="odyssey-btn odyssey-btn--danger">Erase and start over</button>
                    <button id="odyssey-new-journey-cancel-btn" class="odyssey-btn">Keep my journey</button>
                </div>
            </div>
        </footer>
    `;

    document.body.appendChild(container);

    return container;
}

export default createLevelSelectOverlay;
