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
    }

    mount(container) {
        if (!container) return;
        this.container = container;
        this.container.classList.add('steam-leaderboard-panel');
        this._renderShell();
        this._bindHandlers();
        this._load();
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
        this.container.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.dataset.boardId) {
                this._setBoard(target.dataset.boardId);
            }

            if (target.dataset.viewId) {
                this._setView(target.dataset.viewId);
            }
        });
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

    _getCacheKey(boardName) {
        return `${boardName}|${this.currentView}|0|${this.pageSize}`;
    }

    async _load() {
        const board = this._getBoard();
        if (!board) {
            this._renderMessage('No leaderboards configured.');
            return;
        }

        const cacheKey = this._getCacheKey(board.name);
        const ttl = this.cacheTtlByView[this.currentView] ?? this.cacheTtlByView.global;
        const cached = this.cache.get(cacheKey, ttl);

        if (cached?.data?.entries?.length) {
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
                await steamService.waitForInit();
            }
        }

        if (!steamService.isAvailable()) {
            if (!cached?.data?.entries?.length) {
                this._renderMessage('Steam offline. Showing cached scores when available.');
            }
            return;
        }

        await this._fetchLeaderboard(board, cacheKey);
    }

    async _fetchLeaderboard(board, cacheKey) {
        try {
            const response = await steamService.getLeaderboard(
                board.name,
                this.currentView,
                0,
                this.pageSize,
            );

            if (!response?.supported) {
                this.cache.set(cacheKey, {
                    entries: [],
                    supported: false,
                    notice: response?.error || 'Leaderboards unavailable',
                });
                this._renderMessage('Leaderboards unavailable (Steam API missing).');
                return;
            }

            const entries = Array.isArray(response.entries) ? response.entries : [];
            this.cache.set(cacheKey, {
                entries,
                supported: true,
                notice: response?.notice || '',
            });
            this._renderEntries(board, entries, true, response?.notice);
            this._setUpdatedLabel(0);
            this._setStatus('');
        } catch (err) {
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
        rank.textContent = entry.rank ? `#${entry.rank}` : entry.rank === 0 ? '#0' : '—';

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
