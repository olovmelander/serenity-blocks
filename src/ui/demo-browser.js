/**
 * @fileoverview Replays sheet (#demo-browser-modal): the saved replays, newest first,
 * each with Play, Share and Delete. A Keystone sheet (public/styles/keystone-modals.css);
 * it sits outside ModalManager, so it announces itself with the same modalShown /
 * modalHidden events, which give it focus handling and Escape (src/ui/sheet-input.js).
 */
import { eventBus, EVENTS } from '../events/event-bus.js';
import { introAnimation } from './intro-animation.js';
import { csIcon } from './components/cosmic-icons.js';

const STATUS_CLEAR_MS = 4500;
const DELETE_CONFIRM_MS = 4000;

const MODE_NAMES = {
    'single-player': 'Single Player',
    single: 'Single Player',
    infinity: 'Infinity',
};

const TRASH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">'
    + '<path d="M4.5 7h15"/><path d="M9.6 7V5.3a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3V7"/>'
    + '<path d="M6.6 7l.8 11.1a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9L17.4 7"/><path d="M10.3 11v5M13.7 11v5"/></svg>';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Helper function to format time
function formatTime(ms) {
    if (!ms || Number.isNaN(Number(ms))) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatWhen(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return { text: '', iso: '' };
    const day = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return { text: `${day} · ${time}`, iso: date.toISOString() };
}

function modeName(gameMode) {
    if (!gameMode) return 'Single Player';
    if (MODE_NAMES[gameMode]) return MODE_NAMES[gameMode];
    return String(gameMode).replace(/[-_]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

/** Show a status line when the browser has one (shared helpers call this unbound). */
function notify(browser, message, tone) {
    if (typeof browser?.setStatus === 'function') browser.setStatus(message, tone);
}

function replayStat(label, value, modifier = '') {
    return `<div class="stat${modifier ? ` ${modifier}` : ''}"><dt class="stat-label">${label}</dt>`
        + `<dd class="stat-value">${value}</dd></div>`;
}

function formatCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : '0';
}

export class DemoBrowser {
    constructor(demoManager, gameModeManager) {
        this.demoManager = demoManager;
        this.gameModeManager = gameModeManager;
        this.modal = document.getElementById('demo-browser-modal');
        this.listContainer = document.getElementById('demo-list');
        this.importInput = document.getElementById('import-demo-input');
        this.statusEl = document.getElementById('demo-browser-status');
        this.refreshGeneration = 0;
        this.statusTimer = 0;
        this.pendingDelete = null;

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Close button
        const closeBtn = document.getElementById('close-demo-browser');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
                // Return to main menu (intro + start modal)
                eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
            });
        }

        // Import button
        const importBtn = document.getElementById('import-demo-btn');
        if (importBtn && this.importInput) {
            importBtn.addEventListener('click', () => this.importInput.click());
            this.importInput.addEventListener('change', (e) => this.handleFileImport(e));
        }
    }

    isOpen() {
        return Boolean(this.modal?.classList.contains('visible'));
    }

    announce(type) {
        if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
        window.dispatchEvent(new CustomEvent(type, { detail: { modalName: 'demoBrowser' } }));
    }

    show() {
        if (!this.modal) return;
        const wasOpen = this.isOpen();
        this.modal.classList.add('visible');
        this.setStatus('');
        const listed = this.refreshList();
        if (wasOpen) return;
        // Announce once the list is in, so focus lands on the newest replay.
        Promise.resolve(listed).finally(() => {
            if (this.isOpen()) this.announce('modalShown');
        });
    }

    hide() {
        this.refreshGeneration += 1;
        this.clearPendingDelete();
        if (!this.modal) return;
        const wasOpen = this.isOpen();
        this.modal.classList.remove('visible');
        if (wasOpen) this.announce('modalHidden');
    }

    /** A short message under the header (copied, imported, failed) instead of alert(). */
    setStatus(message, tone = 'info') {
        if (!this.statusEl) return;
        clearTimeout(this.statusTimer);
        this.statusEl.textContent = message || '';
        this.statusEl.dataset.tone = tone;
        if (message) {
            this.statusTimer = setTimeout(() => {
                if (this.statusEl) this.statusEl.textContent = '';
            }, STATUS_CLEAR_MS);
        }
    }

    async refreshList() {
        if (!this.listContainer || !this.modal?.classList.contains('visible')) return;
        const generation = ++this.refreshGeneration;
        this.clearPendingDelete();

        this.listContainer.innerHTML = '<p class="loading-spinner" role="status">Loading replays…</p>';

        try {
            const demos = await this.demoManager.listDemos({ includeReplayData: false });
            if (generation !== this.refreshGeneration) return;

            if (demos.length === 0) {
                this.listContainer.innerHTML = `
                    <div class="sb-empty demo-empty">
                        <span class="sb-empty__icon" aria-hidden="true">${csIcon('play', 24)}</span>
                        <p class="sb-empty__title">No replays yet</p>
                        <p class="sb-empty__text">Finish a Single Player game and it is saved here to watch again.
                            A replay file someone shared with you comes in through Import file.</p>
                    </div>`;
                return;
            }

            // Sort by date descending
            demos.sort((a, b) => b.timestamp - a.timestamp);

            this.listContainer.innerHTML = '';

            const fragment = document.createDocumentFragment();
            demos.forEach((demo) => {
                const card = this.createDemoCard(demo);
                fragment.appendChild(card);
            });
            this.listContainer.appendChild(fragment);
        } catch (err) {
            if (generation !== this.refreshGeneration) return;
            console.error('Failed to load demos:', err);
            this.listContainer.innerHTML = '<p class="error-state">'
                + 'Replays could not be loaded. Close this and try again.</p>';
        }
    }

    createDemoCard(demo) {
        const card = document.createElement('article');
        card.className = 'demo-card';

        const when = formatWhen(demo.timestamp);
        const meta = demo.metadata || {};
        const score = formatCount(meta.score ?? meta.finalScore);
        const lines = meta.lines ?? meta.linesCleared;
        const duration = meta.duration ? formatTime(meta.duration) : '—';
        const subject = `replay: ${score} points${when.text ? `, ${when.text}` : ''}`;

        card.innerHTML = `
            <div class="demo-info">
                <div class="demo-header">
                    <span class="demo-mode">${escapeHtml(modeName(demo.gameMode))}</span>
                    <time class="demo-date"${when.iso ? ` datetime="${when.iso}"` : ''}>${escapeHtml(when.text)}</time>
                </div>
                <dl class="demo-stats">
                    ${replayStat('Score', score, 'stat--score')}
                    ${replayStat('Level', formatCount(meta.level || 1))}
                    ${lines != null ? replayStat('Lines', formatCount(lines)) : ''}
                    ${replayStat('Time', duration)}
                </dl>
            </div>
            <div class="demo-actions">
                <button type="button" class="demo-action btn-play" aria-label="Play ${escapeHtml(subject)}">
                    ${csIcon('play', 18)}<span class="demo-action__label" aria-hidden="true">Play</span>
                </button>
                <button type="button" class="demo-action btn-share" aria-label="Share ${escapeHtml(subject)}">
                    ${csIcon('chain', 18)}<span class="demo-action__label" aria-hidden="true">Share</span>
                </button>
                <button type="button" class="demo-action btn-delete" aria-label="Delete ${escapeHtml(subject)}">
                    ${TRASH_ICON}<span class="demo-action__label" aria-hidden="true">Delete</span>
                </button>
            </div>
        `;

        // Add listeners
        card.querySelector('.btn-play').addEventListener('click', () => this.playDemo(demo.id));
        card.querySelector('.btn-share').addEventListener('click', () => this.shareDemo(demo));

        // Delete asks twice, in place: the first press arms it, the second deletes.
        const deleteBtn = card.querySelector('.btn-delete');
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.pendingDelete?.button === deleteBtn) {
                this.clearPendingDelete();
                this.deleteDemo(demo.id);
                return;
            }
            this.armDelete(deleteBtn, subject);
        });
        deleteBtn.addEventListener('blur', () => {
            if (this.pendingDelete?.button === deleteBtn) this.clearPendingDelete();
        });

        return card;
    }

    armDelete(button, subject) {
        this.clearPendingDelete();
        const label = button.querySelector('.demo-action__label');
        button.classList.add('is-confirming');
        if (label) label.textContent = 'Press again to delete';
        button.setAttribute('aria-label', `Press again to delete this ${subject}`);
        this.pendingDelete = {
            button,
            subject,
            timer: setTimeout(() => this.clearPendingDelete(), DELETE_CONFIRM_MS),
        };
    }

    clearPendingDelete() {
        const pending = this.pendingDelete;
        if (!pending) return;
        this.pendingDelete = null;
        clearTimeout(pending.timer);
        pending.button.classList.remove('is-confirming');
        const label = pending.button.querySelector('.demo-action__label');
        if (label) label.textContent = 'Delete';
        pending.button.setAttribute('aria-label', `Delete ${pending.subject}`);
    }

    async playDemo(id) {
        try {
            const demo = await this.demoManager.loadDemo(id);
            if (!demo) throw new Error('Demo not found');

            this.hide();

            // Close all other modals (e.g. Start Modal)
            if (this.gameModeManager.deps && this.gameModeManager.deps.modalManager) {
                this.gameModeManager.deps.modalManager.hideAll();
            }

            if (introAnimation) {
                introAnimation.dismiss();
            }

            // Switch to single player mode and start playback
            // We assume SinglePlayerMode handles 'demo' option in onStart
            await this.gameModeManager.activateMode('single');
            await this.gameModeManager.startCurrentMode({ demo });
        } catch (err) {
            console.error('Failed to play demo:', err);
            notify(this, 'This replay could not be played.', 'error');
        }
    }

    async shareDemo(demo) {
        try {
            // If full demo data isn't in the list item, load it
            let fullDemo = demo;
            if (!demo.inputs) {
                fullDemo = await this.demoManager.loadDemo(demo.id);
            }

            const url = await this.demoManager.exportToURL(fullDemo);
            await navigator.clipboard.writeText(url);
            notify(this, 'Replay link copied to the clipboard.', 'success');
        } catch (err) {
            console.error('Failed to share demo:', err);
            notify(this, 'The replay link could not be copied.', 'error');
        }
    }

    async deleteDemo(id) {
        const hadFocus = typeof document !== 'undefined' && Boolean(this.modal?.contains?.(document.activeElement));
        try {
            await this.demoManager.deleteDemo(id);
            await this.refreshList();
            notify(this, 'Replay deleted.', 'success');
            // The pressed button is gone; keep focus inside the sheet.
            if (hadFocus) {
                (this.listContainer?.querySelector('.btn-play') || document.getElementById('import-demo-btn'))
                    ?.focus({ preventScroll: true });
            }
        } catch (err) {
            console.error('Failed to delete demo:', err);
            notify(this, 'The replay could not be deleted.', 'error');
        }
    }

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const demo = await this.demoManager.importFromJSON(text);
            await this.demoManager.saveDemo(demo);
            await this.refreshList();
            notify(this, 'Replay imported.', 'success');
        } catch (err) {
            console.error('Import failed:', err);
            notify(this, 'That file is not a replay this game can read.', 'error');
        }

        // Reset input
        event.target.value = '';
    }
}
