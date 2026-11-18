/**
 * @fileoverview Steam leaderboard panel (game over, Odyssey results). Board and view
 * switches are toggle buttons (aria-pressed); the game-over sheet draws it in the
 * Keystone language (public/styles/keystone-modals.css).
 *
 * The panel exists only where the Steam client offers leaderboards
 * (`steamLeaderboardsAvailable()`): the results sheets build none otherwise, and a panel whose
 * board turns out to be unsupported takes itself off the sheet instead of saying so. The
 * Steam library the game ships with has no leaderboard API, so today no panel is shown.
 */
import steamService from '../../core/steam/steam-service.js';
import { assessRecords } from '../../core/progression/record-book.js';
import { BOARDS } from '../../core/steam/steam-catalogue.js';
import { LeaderboardCache } from '../leaderboards/leaderboard-cache.js';

const DEFAULT_VIEWS = [
    { id: 'global', label: 'Global' },
    { id: 'friends', label: 'Friends' },
    { id: 'around_user', label: 'Around You' },
];

const DEFAULT_CACHE_TTL = {
    global: 5 * 60 * 1000,
    friends: 60 * 1000,
    around_user: 30 * 1000,
};

/** Whether the Steam client this game runs with offers leaderboards at all. */
export function steamLeaderboardsAvailable() {
    return steamService.capabilities?.leaderboards === true || Boolean(steamService.records?.owner);
}

const defaultCache = new LeaderboardCache();
const pendingRequestsByCache = new WeakMap();

const requestLeaderboard = (request) => {
    let pendingRequests = pendingRequestsByCache.get(request.cache);
    if (!pendingRequests) {
        pendingRequests = new Map();
        pendingRequestsByCache.set(request.cache, pendingRequests);
    }

    const requestKey = JSON.stringify([steamService.steamId, request.cacheKey]);
    let pending = pendingRequests.get(requestKey);
    if (!pending) {
        pending = Promise.resolve().then(() => steamService.getLeaderboard(
            request.board.name,
            request.view,
            request.start,
            request.pageSize,
        )).then(async (response) => {
            const data = response?.supported ? {
                entries: Array.isArray(response.entries) ? response.entries : [],
                supported: true,
                notice: response?.notice || '',
            } : {
                entries: [],
                supported: false,
                notice: response?.error || 'Leaderboards unavailable',
            };
            if (data.supported) {
                if (steamService.getLeaderboardEntry && request.owner && request.owner === steamService.records?.owner) {
                    try {
                        const self = await steamService.getLeaderboardEntry(request.board.name, steamService.steamId);
                        if (self === null || self?.steamId === steamService.steamId) data.self = self;
                    } catch { /* A public page can succeed while the personal lookup fails. */ }
                }
                request.cache.set(request.cacheKey, data);
            }
            return data;
        }).finally(() => {
            if (pendingRequests.get(requestKey) === pending) {
                pendingRequests.delete(requestKey);
            }
        });
        pendingRequests.set(requestKey, pending);
    }
    return pending;
};

/** The compact orb card and the expanded Friends tab share one request and one cache. */
export async function friendComparison(board) {
    const owner = steamService.records?.owner;
    if (!owner) return null;
    const cacheKey = JSON.stringify([steamService.appId, steamService.steamId, board.name, 'friends', 10]);
    const cached = defaultCache.get(cacheKey, DEFAULT_CACHE_TTL.friends);
    let data = cached?.data;
    if (steamService.isAvailable() && (!data || cached.stale)) {
        try {
            const response = await requestLeaderboard({ board, view: 'friends', start: 0, pageSize: 10, cache: defaultCache, cacheKey, owner });
            if (response.supported) data = response;
        } catch { /* Keep the last successful comparison. */ }
    }
    if (!data || owner !== steamService.records?.owner) return null;
    return { self: data.self, friend: data.entries.find((entry) => entry.steamId !== steamService.steamId) };
}

export const formatNumber = (value) => {
    if (typeof value === 'bigint') return value.toString();
    const numeric = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(numeric)) {
        return Number(numeric).toLocaleString();
    }
    return typeof value === 'string' ? value : '-';
};

export const formatSeconds = (value) => {
    if (!Number.isFinite(value)) return '-';
    const totalSeconds = Math.max(0, Math.round(value));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

export const formatMilliseconds = (value) => {
    if (!Number.isFinite(value)) return '-';
    const totalMs = Math.max(0, Math.round(value));
    const totalSeconds = Math.floor(totalMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const millis = totalMs % 1000;
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
};

export function modeBoards(mode) {
    return Object.values(BOARDS).filter((board) => board.mode === mode).map((board) => ({
        ...board, id: board.name, sortOrder: board.orb ? 'asc' : 'desc',
        formatScore: board.orb ? formatMilliseconds : board.unit === 'TimeSeconds' ? formatSeconds : formatNumber,
    }));
}

export const formatWinRate = (value) => {
    if (!Number.isFinite(value)) return '-';
    return `${(value / 100).toFixed(2)}%`;
};

/**
 * A board: `{ id, label, name, currentScore?, formatScore?, sortOrder?, pendingLabel? }`.
 * `currentScore` is this run's score; until Steam lists the player it shows as a pending row,
 * placed where it ranks among the rows shown (`sortOrder` 'asc' for boards where lower is
 * better, such as times; otherwise read from the rows' order, else higher is better).
 */
export class SteamLeaderboardPanel {
    constructor(options = {}) {
        this.title = options.title || 'Steam Leaderboard';
        this.boards = Array.isArray(options.boards) ? options.boards : [];
        this.defaultBoardId = options.defaultBoardId || this.boards[0]?.id || null;
        this.views = Array.isArray(options.views) && options.views.length > 0 ? options.views : DEFAULT_VIEWS;
        this.pageSize = Number.isFinite(options.pageSize) ? options.pageSize : 10;
        this.cache = options.cache || defaultCache;
        this.cacheTtlByView = options.cacheTtlByView || DEFAULT_CACHE_TTL;

        this.currentBoardId = this.defaultBoardId;
        this.currentView = this.views[0]?.id || 'global';

        this.container = null;
        this.listEl = null;
        this.statusEl = null;
        this.updatedEl = null;
        this.active = false;
        this.loadGeneration = 0;
        this._onClick = null;
    }

    mount(container) {
        if (!container) return;
        this.destroy();
        this.container = container;
        this.active = true;
        this.container.classList.add('steam-leaderboard-panel');
        this._renderShell();
        this._bindHandlers();
        this.unsubscribe = steamService.on?.('steam:score-confirmed', ({ name, owner }) => {
            if (owner !== steamService.records?.owner) return;
            for (const view of this.views) this.cache.clear(this._getCacheKey(name, view.id));
            if (this._getBoard()?.name === name && this.active) this._load();
        });
        this._showSharing();
        this._load();
    }

    hide() {
        this.active = false;
        this.loadGeneration += 1;
    }

    show() {
        if (!this.container || this.active) return;
        this.active = true;
        this._load();
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
        this.hide();
        if (this.container && this._onClick) {
            this.container.removeEventListener('click', this._onClick);
        }
        this._onClick = null;
        this.container = null;
        this.listEl = null;
        this.statusEl = null;
        this.updatedEl = null;
    }

    async _showSharing() {
        const records = steamService.records;
        const host = this.container;
        if (!host || !records?.owner || !records.manager) return;
        const owner = records.owner;
        const stats = await records.manager.getStatistics().catch(() => null);
        if (this.container !== host || records.owner !== owner || !stats) return;
        const bests = assessRecords(stats.recordBook, owner).bests;
        records.bests = bests;
        const consent = document.createElement('div');
        consent.className = 'steam-score-sharing';
        const draw = () => {
            consent.replaceChildren();
            const share = records.sharing();
            const msg = document.createElement('p');
            const hasRun = Object.keys(bests).length > 0;
            msg.textContent = share === true ? 'Sharing eligible personal bests on Steam. Stopping sharing keeps existing entries. Contact support from Privacy to remove them.'
                : hasRun ? 'Share your best scores on Steam? Other players can see your Steam name, rank, score or time, and a few run statistics. Replays stay on this device.' : 'Steam score sharing is off.';
            consent.appendChild(msg);
            const action = (label, value) => {
                const button = document.createElement('button');
                button.type = 'button'; button.textContent = label;
                button.addEventListener('click', () => {
                    if (records.owner !== owner) return;
                    records.setSharing(value);
                    draw();
                    consent.querySelector('button')?.focus();
                });
                consent.appendChild(button);
            };
            action(share ? 'Stop sharing' : 'Share scores', !share);
            if (share === null && hasRun) action('Keep local', false);
        };
        draw();
        host.appendChild(consent);
        try { records.save({ viewed: true }); } catch { /* Browsing still works with local storage full. */ }
    }

    _renderShell() {
        this.container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'steam-leaderboard-header';
        header.innerHTML = `
            <div class="steam-leaderboard-title">${this.title}</div>
            <div class="steam-leaderboard-updated" id="steam-leaderboard-updated">--</div>
        `;
        this.container.appendChild(header);

        if (this.boards.length > 8) {
            const select = document.createElement('select');
            select.setAttribute('aria-label', 'Odyssey leaderboard');
            for (const board of this.boards) {
                const option = document.createElement('option');
                option.value = board.id; option.textContent = board.label;
                select.appendChild(option);
            }
            select.value = this.currentBoardId;
            select.addEventListener('change', () => this._setBoard(select.value));
            this.container.appendChild(select);
        } else if (this.boards.length > 1) {
            const boardTabs = document.createElement('div');
            boardTabs.className = 'steam-leaderboard-board-tabs';
            boardTabs.setAttribute?.('role', 'group');
            boardTabs.setAttribute?.('aria-label', 'Leaderboard');
            this.boards.forEach((board) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'steam-leaderboard-tab';
                btn.dataset.boardId = board.id;
                btn.textContent = board.label;
                const active = board.id === this.currentBoardId;
                if (active) {
                    btn.classList.add('active');
                }
                btn.setAttribute?.('aria-pressed', String(active));
                boardTabs.appendChild(btn);
            });
            this.container.appendChild(boardTabs);
        }

        if (this.views.length > 1) {
            const viewTabs = document.createElement('div');
            viewTabs.className = 'steam-leaderboard-view-tabs';
            viewTabs.setAttribute?.('role', 'group');
            viewTabs.setAttribute?.('aria-label', 'Players');
            this.views.forEach((view) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'steam-leaderboard-tab steam-leaderboard-view-tab';
                btn.dataset.viewId = view.id;
                btn.textContent = view.label;
                const active = view.id === this.currentView;
                if (active) {
                    btn.classList.add('active');
                }
                btn.setAttribute?.('aria-pressed', String(active));
                viewTabs.appendChild(btn);
            });
            this.container.appendChild(viewTabs);
        }

        const list = document.createElement('div');
        list.className = 'steam-leaderboard-list';
        this.listEl = list;
        this.container.appendChild(list);

        const status = document.createElement('div');
        status.className = 'steam-leaderboard-status';
        status.setAttribute?.('role', 'status');
        status.textContent = 'Loading leaderboards…';
        this.statusEl = status;
        this.container.appendChild(status);

        this.updatedEl = header.querySelector('#steam-leaderboard-updated');
    }

    _bindHandlers() {
        this._onClick = (event) => {
            if (!this.active) return;
            const { target } = event;
            if (!(target instanceof HTMLElement)) return;

            if (target.dataset.boardId) {
                this._setBoard(target.dataset.boardId);
            }

            if (target.dataset.viewId) {
                this._setView(target.dataset.viewId);
            }
        };
        this.container.addEventListener('click', this._onClick);
    }

    _setBoard(boardId) {
        if (!boardId || this.currentBoardId === boardId) return;
        this.currentBoardId = boardId;
        this.self = undefined;
        this._updateTabState('boardId', boardId);
        this._load();
    }

    _setView(viewId) {
        if (!viewId || this.currentView === viewId) return;
        this.currentView = viewId;
        this._updateTabState('viewId', viewId);
        this._load();
    }

    _updateTabState(dataKey, activeValue) {
        const selector = dataKey === 'boardId' ? '[data-board-id]' : '[data-view-id]';
        this.container.querySelectorAll(selector).forEach((btn) => {
            if (!(btn instanceof HTMLElement)) return;
            const isActive = btn.dataset[dataKey] === activeValue;
            btn.classList.toggle('active', isActive);
            btn.setAttribute?.('aria-pressed', String(isActive));
        });
    }

    _getBoard() {
        return this.boards.find((board) => board.id === this.currentBoardId) || this.boards[0];
    }

    _getCacheKey(boardName, view = this.currentView, pageSize = this.pageSize) {
        return JSON.stringify([steamService.appId, steamService.steamId, boardName, view, pageSize]);
    }

    _ownsRequest(request) {
        return this.active
            && request.owner === steamService.records?.owner
            && this.container === request.container
            && this.loadGeneration === request.generation
            && this.currentBoardId === request.boardId
            && this.currentView === request.view
            && this.pageSize === request.pageSize;
    }

    async _load() {
        if (!this.active || !this.container) return;
        const generation = ++this.loadGeneration;
        const board = this._getBoard();
        if (!board) {
            this._renderMessage('No leaderboards configured.');
            return;
        }

        const request = {
            board: { ...board },
            boardId: this.currentBoardId,
            view: this.currentView,
            start: 0,
            pageSize: this.pageSize,
            cache: this.cache,
            owner: steamService.records?.owner,
            cacheKey: this._getCacheKey(board.name, this.currentView, this.pageSize),
            container: this.container,
            generation,
        };
        const ttl = this.cacheTtlByView[request.view] ?? this.cacheTtlByView.global;
        const cached = request.cache.get(request.cacheKey, ttl);
        const hasCachedEntries = cached?.data?.supported
            && Array.isArray(cached.data.entries);

        if (hasCachedEntries) {
            this.self = cached.data.self;
            this._renderEntries(board, cached.data.entries, cached.data.supported, cached.data.notice);
            this._setUpdatedLabel(cached.ageMs);
            if (!cached.stale) {
                this._setStatus(steamService.isAvailable() ? '' : 'Steam is offline. Showing saved scores.');
                return;
            }
            this._setStatus('Refreshing…');
        } else {
            this._renderMessage('Loading leaderboard…');
        }

        if (!steamService.isAvailable()) {
            if (!steamService.initComplete) {
                try {
                    await steamService.waitForInit();
                } catch (err) {
                    if (this._ownsRequest(request)) {
                        console.warn('[SteamLeaderboardPanel] Failed to initialize Steam:', err.message);
                        this._setStatus('Failed to refresh leaderboard.');
                    }
                    return;
                }
            }
        }

        if (!this._ownsRequest(request)) return;

        if (!steamService.isAvailable()) {
            if (!hasCachedEntries) {
                this._renderMessage('Steam is offline. Your local records are available.');
            } else {
                this._setStatus('Steam is offline. Showing saved scores.');
            }
            return;
        }

        await this._fetchLeaderboard(request);
    }

    async _fetchLeaderboard(request) {
        try {
            const response = await requestLeaderboard(request);
            if (!this._ownsRequest(request)) return;

            if (!response.supported) {
                const saved = request.cache.get(request.cacheKey);
                this._setStatus(saved?.data?.supported ? 'Could not refresh. Showing saved scores.' : (response.notice || 'Steam leaderboard unavailable.') + ' Try again when Steam is online.');
                return;
            }

            this.container.hidden = false;
            this.self = response.self;
            this._renderEntries(request.board, response.entries, true, response.notice);
            this._setUpdatedLabel(0);
            this._setStatus('');
        } catch (err) {
            if (!this._ownsRequest(request)) return;
            console.warn('[SteamLeaderboardPanel] Failed to fetch leaderboard:', err.message);
            this._setStatus('Failed to refresh leaderboard.');
        }
    }

    _setUpdatedLabel(ageMs) {
        if (!this.updatedEl) return;
        if (!Number.isFinite(ageMs) || ageMs <= 0) {
            this.updatedEl.textContent = 'Updated just now';
            return;
        }
        const seconds = Math.round(ageMs / 1000);
        if (seconds < 60) {
            this.updatedEl.textContent = `Updated ${seconds}s ago`;
        } else {
            const minutes = Math.round(seconds / 60);
            this.updatedEl.textContent = `Updated ${minutes}m ago`;
        }
    }

    _setStatus(text) {
        if (this.statusEl) {
            this.statusEl.textContent = text;
            this.statusEl.style.display = text ? 'block' : 'none';
        }
    }

    _renderMessage(message) {
        if (this.listEl) {
            this.listEl.innerHTML = '';
        }
        this._setStatus(message);
    }

    _renderEntries(board, entries, supported, notice) {
        if (!this.listEl) return;

        const list = document.createElement('div');
        list.className = 'steam-leaderboard-entries';

        const formatScore = board.formatScore || formatNumber;
        const currentScore = Number.isFinite(board.currentScore) ? board.currentScore : steamService.records?.bests?.[board.name]?.score ?? null;
        const localSteamId = steamService.steamId;

        const normalizedEntries = Array.isArray(entries) ? entries.slice(0, this.pageSize) : [];
        const hasSelfEntry = localSteamId
            ? normalizedEntries.some((entry) => `${entry.steamId}` === `${localSteamId}`)
            : false;

        // This run's score, not yet on the board, sits where its value ranks among the rows
        // shown (unranked: it has no place number until Steam gives it one).
        const existingScore = normalizedEntries.find((r) => String(r.steamId) === String(localSteamId))?.score ?? this.self?.score;
        const improves = existingScore == null || (this._sortOrder(board, normalizedEntries) === 'asc' ? currentScore < existingScore : currentScore > existingScore);
        const pendingRow = currentScore !== null && improves && steamService.records?.isPending(board.name, currentScore) ? this._createRow({
            rank: null,
            name: board.pendingLabel || 'You (pending)',
            score: currentScore,
            pending: true,
            steamId: localSteamId,
        }, formatScore) : null;
        const pendingIndex = pendingRow
            ? this._pendingIndex(board, normalizedEntries, currentScore) : -1;
        // Slower or lower than a full page: it ranks somewhere below, not right after the last row.
        if (pendingRow && pendingIndex >= this.pageSize) pendingRow.classList.add('beyond');

        if (normalizedEntries.length === 0) {
            if (pendingRow) list.appendChild(pendingRow);
            const empty = document.createElement('div');
            empty.className = 'steam-leaderboard-empty';
            empty.textContent = supported ? 'No scores yet.' : 'Leaderboards unavailable.';
            list.appendChild(empty);
        } else {
            normalizedEntries.forEach((entry, index) => {
                if (index === pendingIndex) list.appendChild(pendingRow);
                list.appendChild(this._createRow(entry, formatScore, localSteamId));
            });
            if (pendingRow && pendingIndex >= normalizedEntries.length) list.appendChild(pendingRow);
        }

        if (this.self && !hasSelfEntry) list.appendChild(this._createRow(this.self, formatScore, localSteamId));
        if (this.self !== undefined) {
            const own = document.createElement('div');
            own.className = 'steam-leaderboard-notice';
            own.textContent = this.self ? 'My rank · #' + this.self.rank : 'My rank · No entry yet';
            list.appendChild(own);
        }
        if (notice) {
            const noticeEl = document.createElement('div');
            noticeEl.className = 'steam-leaderboard-notice';
            noticeEl.textContent = notice;
            list.appendChild(noticeEl);
        }

        this.listEl.innerHTML = '';
        this.listEl.appendChild(list);
        this._setStatus('');
    }

    /**
     * Which way a board ranks: `board.sortOrder` ('asc' when lower is better, as for times;
     * 'desc' when higher is better), else read from the rows' own order, else higher is better.
     */
    _sortOrder(board, entries) {
        if (board?.sortOrder === 'asc' || board?.sortOrder === 'desc') return board.sortOrder;
        const scores = entries.map((entry) => Number(entry.score)).filter(Number.isFinite);
        const first = scores[0];
        const last = scores[scores.length - 1];
        if (scores.length >= 2 && first !== last) return first < last ? 'asc' : 'desc';
        return 'desc';
    }

    /** The row index a score would take among `entries`: after every row it does not beat. */
    _pendingIndex(board, entries, score) {
        const ascending = this._sortOrder(board, entries) === 'asc';
        const index = entries.findIndex((entry) => {
            const value = Number(entry.score);
            if (!Number.isFinite(value)) return false;
            return ascending ? score < value : score > value;
        });
        return index === -1 ? entries.length : index;
    }

    _createRow(entry, formatScore, localSteamId) {
        const row = document.createElement('div');
        row.className = 'steam-leaderboard-row';

        if (entry.pending) {
            row.classList.add('pending');
        }

        if (localSteamId && `${entry.steamId}` === `${localSteamId}`) {
            row.classList.add('self');
        }

        const rank = document.createElement('div');
        rank.className = 'steam-leaderboard-rank';
        rank.textContent = entry.rank || entry.rank === 0 ? `#${entry.rank}` : '—';

        const name = document.createElement('div');
        name.className = 'steam-leaderboard-name';
        name.textContent = entry.name || 'Unknown';

        const score = document.createElement('div');
        score.className = 'steam-leaderboard-score';
        score.textContent = formatScore(entry.score);

        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(score);

        return row;
    }
}
