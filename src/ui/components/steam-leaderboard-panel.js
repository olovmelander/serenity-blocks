import steamService from '../../core/steam/steam-service.js';
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
        )).then((response) => {
            const data = response?.supported ? {
                entries: Array.isArray(response.entries) ? response.entries : [],
                supported: true,
                notice: response?.notice || '',
            } : {
                entries: [],
                supported: false,
                notice: response?.error || 'Leaderboards unavailable',
            };
            request.cache.set(request.cacheKey, data);
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
    return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(millis / 10)
        .toString()
        .padStart(2, '0')}`;
};

export const formatWinRate = (value) => {
    if (!Number.isFinite(value)) return '-';
    return `${(value / 100).toFixed(2)}%`;
};

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

    _renderShell() {
        this.container.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'steam-leaderboard-header';
        header.innerHTML = `
            <div class="steam-leaderboard-title">${this.title}</div>
            <div class="steam-leaderboard-updated" id="steam-leaderboard-updated">--</div>
        `;
        this.container.appendChild(header);

        if (this.boards.length > 1) {
            const boardTabs = document.createElement('div');
            boardTabs.className = 'steam-leaderboard-board-tabs';
            this.boards.forEach((board) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'steam-leaderboard-tab';
                btn.dataset.boardId = board.id;
                btn.textContent = board.label;
                if (board.id === this.currentBoardId) {
                    btn.classList.add('active');
                }
                boardTabs.appendChild(btn);
            });
            this.container.appendChild(boardTabs);
        }

        if (this.views.length > 1) {
            const viewTabs = document.createElement('div');
            viewTabs.className = 'steam-leaderboard-view-tabs';
            this.views.forEach((view) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'steam-leaderboard-tab steam-leaderboard-view-tab';
                btn.dataset.viewId = view.id;
                btn.textContent = view.label;
                if (view.id === this.currentView) {
                    btn.classList.add('active');
                }
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
        });
    }

    _getBoard() {
        return this.boards.find((board) => board.id === this.currentBoardId) || this.boards[0];
    }

    _getCacheKey(boardName, view = this.currentView, pageSize = this.pageSize) {
        return `${boardName}|${view}|0|${pageSize}`;
    }

    _ownsRequest(request) {
        return this.active
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
            cacheKey: this._getCacheKey(board.name, this.currentView, this.pageSize),
            container: this.container,
            generation,
        };
        const ttl = this.cacheTtlByView[request.view] ?? this.cacheTtlByView.global;
        const cached = request.cache.get(request.cacheKey, ttl);
        const hasCachedEntries = cached?.data?.supported
            && Array.isArray(cached.data.entries);

        if (hasCachedEntries) {
            this._renderEntries(board, cached.data.entries, cached.data.supported, cached.data.notice);
            this._setUpdatedLabel(cached.ageMs);
            if (!cached.stale) {
                this._setStatus('');
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
                this._renderMessage('Steam offline. Showing cached scores when available.');
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
                this._renderMessage('Leaderboards unavailable (Steam API missing).');
                return;
            }

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
        const currentScore = Number.isFinite(board.currentScore) ? board.currentScore : null;
        const localSteamId = steamService.steamId;

        const normalizedEntries = Array.isArray(entries) ? entries.slice(0, this.pageSize) : [];
        const hasSelfEntry = localSteamId
            ? normalizedEntries.some((entry) => `${entry.steamId}` === `${localSteamId}`)
            : false;

        if (currentScore !== null && !hasSelfEntry) {
            const pendingRow = this._createRow({
                rank: '—',
                name: 'You (pending)',
                score: currentScore,
                pending: true,
                steamId: localSteamId,
            }, formatScore);
            list.appendChild(pendingRow);
        }

        if (normalizedEntries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'steam-leaderboard-empty';
            empty.textContent = supported ? 'No scores yet.' : 'Leaderboards unavailable.';
            list.appendChild(empty);
        } else {
            normalizedEntries.forEach((entry) => {
                list.appendChild(this._createRow(entry, formatScore, localSteamId));
            });
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
