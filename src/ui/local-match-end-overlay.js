/**
 * @fileoverview Local versus results (`#match-end-overlay`): the winner, then every
 * player's match in one table — a column per player in their hue, grouped rows of
 * numbers that count up once. One primary action, Play again, and Main menu beside
 * it; Escape is Main menu.
 *
 * Extracted from LocalMultiplayerMode._showMatchEnd, which still assembles the
 * numbers and owns what the buttons do (it passes callbacks). Styles:
 * public/styles/keystone-multiplayer.css (#match-end-overlay).
 */
import { csIcon } from './components/cosmic-icons.js';
import { closeLayer, mpIcon, openLayer } from './components/mp-sheet.js';
import { escapeHtml, sanitizeCssColor } from '../utils/dom-safety.js';

const FADE_MS = 300;
const COUNT_UP_MS = 1200;

/** [label, icon, accessor, title?] rows, in groups. */
const GROUPS = [
    ['Match', [
        ['Score', 'trophy', (p) => p.score],
        ['Frags', 'crossed-swords', (p) => p.frags],
        ['Deaths', 'skull', (p) => p.deaths],
        ['Lines', 'line-stack', (p) => p.lines],
    ]],
    ['Pace', [
        ['BPM', 'bolt', (p) => p.bpm, 'Blocks per minute'],
        ['PPM', 'chart-up', (p) => p.ppm, 'Points per minute'],
        ['PPS', 'match-start', (p) => p.pps, 'Pieces per second'],
        ['APM', 'burst', (p) => p.apm, 'Attacks per minute'],
    ]],
    ['Clears', [
        ['Single', 1, (p) => p.clears?.[1] || 0],
        ['Double', 2, (p) => p.clears?.[2] || 0],
        ['Triple', 3, (p) => p.clears?.[3] || 0],
        ['Quad', 4, (p) => p.clears?.[4] || 0],
    ]],
    ['Attack', [
        ['Attacks sent', 'inbox', (p) => p.attacksSent],
        ['Attack lines', 'crossed-swords', (p) => p.attackLinesSent],
        ['Clean lines', 'star', (p) => p.cleanLinesSent],
        ['Max combo', 'chain', (p) => p.maxCombo],
        ['Max cascade', 'spiral', (p) => p.maxDepth],
    ]],
];

const POTATO_GROUP = ['Hot potato', [
    ['Passes', 'potato', (p) => p.potatoPasses],
    ['Hits', 'bomb', (p) => p.potatoHits],
]];

function rowIcon(icon) {
    if (typeof icon === 'number') return `<span class="lme-icon lme-icon--count" aria-hidden="true">${icon}</span>`;
    return `<span class="lme-icon" aria-hidden="true">${csIcon(icon, 16)}</span>`;
}

function cellValue(value) {
    const isNum = typeof value === 'number' && Number.isFinite(value);
    // Numbers count up from 0; anything else (e.g. PPS "1.42") is shown as is.
    return isNum
        ? `<span class="stat-value" data-target="${value}">0</span>`
        : `<span class="stat-value">${escapeHtml(String(value ?? 0))}</span>`;
}

function countUp(root) {
    const counters = Array.from(root.querySelectorAll('.stat-value[data-target]'));
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const finish = () => counters.forEach((el) => {
        el.textContent = Number(el.dataset.target).toLocaleString();
    });
    if (reduced || typeof requestAnimationFrame !== 'function') {
        finish();
        return;
    }
    let start = null;
    const step = (now) => {
        if (!root.isConnected) return;
        if (start === null) start = now;
        const progress = Math.min((now - start) / COUNT_UP_MS, 1);
        const ease = 1 - (1 - progress) ** 4;
        counters.forEach((el) => {
            el.textContent = Math.floor(ease * Number(el.dataset.target)).toLocaleString();
        });
        if (progress < 1) requestAnimationFrame(step);
        else finish();
    };
    requestAnimationFrame(step);
}

/**
 * Show the local results. Returns the overlay element.
 * @param {Object} options
 * @param {string} options.title            hero line, e.g. "Player 1 wins"
 * @param {string} options.winCondition     e.g. "First to 7 frags wins"
 * @param {Array<Object>} options.players   per-player numbers + {name, color, isWinner}
 * @param {boolean} [options.potatoPlayed]  add the Hot potato rows
 * @param {Function} options.onPlayAgain    after the overlay fades out
 * @param {Function} options.onMainMenu     after the overlay fades out
 */
export function showLocalMatchEnd({
    title, winCondition, players, potatoPlayed = false, onPlayAgain, onMainMenu,
}) {
    document.getElementById('match-end-overlay')?.remove();
    const winner = players.find((p) => p.isWinner);
    const groups = potatoPlayed ? [...GROUPS, POTATO_GROUP] : GROUPS;

    const head = players.map((p, i) => `
        <th scope="col" class="lme-player${p.isWinner ? ' is-winner' : ''}" style="--player-color:${sanitizeCssColor(p.color, '#b8a4ff')}">
            <span class="lme-player__tile" aria-hidden="true">P${i + 1}</span>
            <span class="lme-player__name">${escapeHtml(p.name)}</span>
            ${p.isWinner ? `<span class="lme-player__crown" role="img" aria-label="Winner">${csIcon('crown', 16)}</span>` : ''}
        </th>`).join('');

    const body = groups.map(([group, rows]) => `
        <tbody class="lme-group">
            <tr class="lme-group__head"><th scope="rowgroup" colspan="${players.length + 1}">${group}</th></tr>
            ${rows.map(([label, icon, read, full]) => `
            <tr>
                <th scope="row" class="lme-stat">${rowIcon(icon)}<span>${full ? `<abbr title="${full}">${label}</abbr>` : label}</span></th>
                ${players.map((p) => `<td class="${p.isWinner ? 'is-winner' : ''}">${cellValue(read(p))}</td>`).join('')}
            </tr>`).join('')}
        </tbody>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'match-end-overlay';
    overlay.className = 'sb-mp-screen';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'match-end-title');
    overlay.setAttribute('aria-describedby', 'match-end-condition');
    if (winner) overlay.style.setProperty('--winner-color', sanitizeCssColor(winner.color, '#f5aed0'));
    overlay.innerHTML = `
        <div class="sb-mp-sheet lme-sheet">
            <div class="sb-mp-sheet__panel">
                <header class="lme-hero">
                    <p class="sb-eyebrow">Local versus · Match complete</p>
                    <div class="lme-hero__title">
                        ${winner ? `<span class="lme-hero__crown" aria-hidden="true">${csIcon('crown', 30)}</span>` : ''}
                        <h2 id="match-end-title">${escapeHtml(title)}</h2>
                    </div>
                    <p class="lme-hero__condition" id="match-end-condition">${escapeHtml(winCondition)}</p>
                </header>
                <div class="match-end-scroll-area sb-mp-sheet__body">
                    <table class="lme-table" style="--players:${players.length}">
                        <caption class="mr-sr">Match statistics for each player</caption>
                        <thead><tr><th scope="col" class="lme-stat lme-stat--head">Statistic</th>${head}</tr></thead>
                        ${body}
                    </table>
                </div>
                <footer class="match-end-actions sb-mp-sheet__footer">
                    <ul class="sb-hints sb-mp-sheet__hints" aria-hidden="true">
                        <li><kbd class="sb-kbd" data-key>Enter</kbd><kbd class="sb-kbd" data-pad>A</kbd>Play again</li>
                        <li><kbd class="sb-kbd" data-key>Esc</kbd><kbd class="sb-kbd" data-pad>B</kbd>Main menu</li>
                    </ul>
                    <div class="sb-mp-sheet__actions">
                        <button type="button" id="return-to-menu-btn" class="sb-btn sb-btn--quiet">${mpIcon('home', 16)}<span>Main menu</span></button>
                        <button type="button" id="restart-match-btn" class="sb-btn sb-btn--primary">${mpIcon('rematch', 16)}<span>Play again</span></button>
                    </div>
                </footer>
            </div>
            <span class="sb-mp-sheet__key" aria-hidden="true"></span>
        </div>`;

    document.body.appendChild(overlay);

    let leaving = false;
    const leave = (then) => {
        if (leaving) return;
        leaving = true;
        closeLayer(overlay);
        overlay.classList.add('is-leaving');
        setTimeout(() => {
            overlay.remove();
            then?.();
        }, FADE_MS);
    };
    overlay.querySelector('#restart-match-btn').addEventListener('click', () => leave(onPlayAgain));
    overlay.querySelector('#return-to-menu-btn').addEventListener('click', () => leave(onMainMenu));
    // Keys pressed on the results belong to the results, not the stopped match.
    overlay.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') event.stopPropagation();
    });
    openLayer(overlay, () => leave(onMainMenu));

    countUp(overlay);
    requestAnimationFrame(() => overlay.querySelector('#restart-match-btn')?.focus({ preventScroll: true }));
    return overlay;
}
