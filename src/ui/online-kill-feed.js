/**
 * OnlineKillFeed - Battle log component for online multiplayer
 *
 * Shows recent kills/deaths and combat events in chronological order
 */
export class OnlineKillFeed {
    constructor(container, options = {}) {
        this.container = container;
        this.listContainer = null;
        // The Battle Log is a TRANSACTIONAL, append-only record of the whole match:
        // every entry stays for the entire match (no per-entry TTL) and we keep a
        // generous history instead of a 12-row transient HUD that silently empties out.
        // (Callers can opt back into the old ephemeral feed by passing maxItems/itemTTL.)
        this.maxItems = options.maxItems ?? 200;
        this.itemTTL = options.itemTTL ?? Infinity; // Infinity = never auto-expire
        this.items = [];
        this.expireTimer = null;

        this._initializeDOM();
    }

    /**
     * Initialize DOM references
     */
    _initializeDOM() {
        if (!this.container) return;

        this.listContainer = this.container.querySelector('#kill-feed-list')
            || this.container.querySelector('.kill-feed-list');
    }

    /**
     * Returns true if `key` was seen within the last 3s (used to collapse the same
     * combat event arriving from multiple sources into a single row).
     */
    _isDuplicate(key) {
        if (!key) return false;
        const now = Date.now();
        if (!this._recentKeys) this._recentKeys = new Map();
        // Cheap prune so the map can't grow unbounded.
        if (this._recentKeys.size > 64) {
            for (const [k, t] of this._recentKeys) {
                if (now - t > 5000) this._recentKeys.delete(k);
            }
        }
        const last = this._recentKeys.get(key);
        this._recentKeys.set(key, now);
        return last != null && now - last < 3000;
    }

    /**
     * Add a kill event to the feed
     * @param {Object} event - { killer: string, victim: string, linesCleared?: number }
     */
    addKill(event) {
        // Dedup: the same death can reach the feed from both a local event and the
        // host's network broadcast (or a fragile double-record). Prefer a stable
        // eventId (identical on host + peer) over the victim-name fallback so the two
        // nodes can't diverge based on local-emit vs network-arrival timing.
        if (this._isDuplicate(event.eventId || `kill:${event.victim}`)) return;

        const isSelfKill = typeof event.isSelfKill === 'boolean'
            ? event.isSelfKill
            : !event.killer;
        const item = {
            type: 'kill',
            killer: event.killer,
            victim: event.victim,
            linesCleared: event.linesCleared,
            killerColor: event.killerColor,
            victimColor: event.victimColor,
            isSelfKill,
            timestamp: Date.now(),
            expiresAt: Date.now() + this.itemTTL,
        };

        this.items.unshift(item);

        // Verifiedt to max items
        if (this.items.length > this.maxItems) {
            this.items.pop();
        }

        this.render();
        this._scheduleExpire();
    }

    /**
     * Add a garbage send event
     * @param {Object} event - { sender: string, target: string, lines: number }
     */
    addGarbageSent(event) {
        const item = {
            type: 'garbage',
            sender: event.sender,
            target: event.target,
            lines: event.lines,
            senderColor: event.senderColor,
            targetColor: event.targetColor,
            timestamp: Date.now(),
            expiresAt: Date.now() + this.itemTTL,
        };

        this.items.unshift(item);

        if (this.items.length > this.maxItems) {
            this.items.pop();
        }

        this.render();
        this._scheduleExpire();
    }

    /**
     * Add a garbage cancellation event (Phase 3.5 - Quadra style)
     * @param {Object} event - { player: string, linesCancelled: number, playerColor?: string }
     */
    addGarbageCancelled(event) {
        const item = {
            type: 'cancel',
            player: event.player,
            linesCancelled: event.linesCancelled,
            playerColor: event.playerColor,
            timestamp: Date.now(),
            expiresAt: Date.now() + this.itemTTL,
        };

        this.items.unshift(item);

        if (this.items.length > this.maxItems) {
            this.items.pop();
        }

        this.render();
        this._scheduleExpire();
    }

    /**
     * Add a combo event
     */
    addCombo(event) {
        this._addItem({
            type: 'combo',
            player: event.player,
            count: event.count,
            playerColor: event.playerColor,
        });
    }

    /**
     * Add a system event (join/leave/disconnect)
     */
    addSystemEvent(type, event) {
        this._addItem({
            type: type, // 'join', 'leave', 'disconnect'
            player: event.player,
            playerColor: event.playerColor,
        });
    }

    /**
     * Add a round divider so the transactional (cross-round) log stays readable:
     * prior rounds' rows are kept, just separated by a "— Round N —" marker.
     */
    addRoundMarker(roundNumber) {
        this._addItem({ type: 'round', roundNumber });
    }

    _addItem(itemData) {
        const item = {
            ...itemData,
            timestamp: Date.now(),
            expiresAt: Date.now() + this.itemTTL,
        };

        this.items.unshift(item);
        if (this.items.length > this.maxItems) this.items.pop();

        this.render();
        this._scheduleExpire();
    }

    /**
     * Render the kill feed
     */
    render() {
        if (!this.listContainer) return;

        const now = Date.now();
        this.items = this.items.filter((item) => item.expiresAt > now);

        const html = this.items.map((item) => {
            const expiringSoon = item.expiresAt - now <= 1000;
            const classes = ['kill-feed-item'];
            if (expiringSoon) classes.push('expiring');

            if (item.type === 'kill') {
                const victimStyle = item.victimColor ? ` style="color: ${item.victimColor};"` : '';
                if (item.isSelfKill) {
                    return `
                    <div class="${classes.join(' ')} self-kill">
                        <span class="kill-icon">☠️</span>
                        <span class="victim"${victimStyle}>${this._escapeHtml(item.victim)}</span>
                        <span class="kill-note">topped out</span>
                    </div>
                `;
                }

                const killerLabel = item.killer || 'Unknown';
                const killerStyle = item.killerColor ? ` style="color: ${item.killerColor};"` : '';

                return `
                    <div class="${classes.join(' ')}">
                        <span class="killer"${killerStyle}>${this._escapeHtml(killerLabel)}</span>
                        ⚔️
                        <span class="victim"${victimStyle}>${this._escapeHtml(item.victim)}</span>
                    </div>
                `;
            }

            if (item.type === 'cancel') {
                // Phase 3.5: Garbage cancellation event (Quadra style)
                const playerStyle = item.playerColor ? ` style="color: ${item.playerColor};"` : '';
                return `
                    <div class="${classes.join(' ')} cancel-event">
                        <span class="cancel-icon">🛡️</span>
                        <span class="player"${playerStyle}>${this._escapeHtml(item.player)}</span>
                        <span class="cancel-note">cancelled ${item.linesCancelled} line${item.linesCancelled !== 1 ? 's' : ''}</span>
                    </div>
                `;
            }

            if (item.type === 'round') {
                return `
                    <div class="${classes.join(' ')} round-divider">
                        <span class="round-note">— Round ${this._escapeHtml(String(item.roundNumber ?? ''))} —</span>
                    </div>
                `;
            }

            if (item.type === 'combo') {
                const playerStyle = item.playerColor ? ` style="color: ${item.playerColor};"` : '';
                return `
                    <div class="${classes.join(' ')} combo-event">
                        <span class="combo-icon">🔥</span>
                        <span class="player"${playerStyle}>${this._escapeHtml(item.player)}</span>
                        <span class="combo-note">${item.count}x COMBO!</span>
                    </div>
                `;
            }

            if (item.type === 'join' || item.type === 'leave' || item.type === 'disconnect') {
                const playerStyle = item.playerColor ? ` style="color: ${item.playerColor};"` : '';
                let icon = '👋';
                let action = 'joined';

                if (item.type === 'leave') {
                    icon = '🚪';
                    action = 'left';
                } else if (item.type === 'disconnect') {
                    icon = '🔌';
                    action = 'disconnected';
                }

                return `
                    <div class="${classes.join(' ')} system-event">
                        <span class="system-icon">${icon}</span>
                        <span class="player"${playerStyle}>${this._escapeHtml(item.player)}</span>
                        <span class="system-note">${action} the match</span>
                    </div>
                `;
            }

            const senderStyle = item.senderColor ? ` style="color: ${item.senderColor};"` : '';
            const targetStyle = item.targetColor ? ` style="color: ${item.targetColor};"` : '';
            return `
                    <div class="${classes.join(' ')}">
                        <span class="killer"${senderStyle}>${this._escapeHtml(item.sender)}</span>
                        → ${item.lines} lines →
                        <span class="victim"${targetStyle}>${this._escapeHtml(item.target)}</span>
                    </div>
                `;
        }).join('');

        this.listContainer.innerHTML = html;
    }

    _scheduleExpire() {
        if (this.expireTimer) {
            clearTimeout(this.expireTimer);
        }

        // Transactional mode (itemTTL = Infinity): entries never expire, so there's
        // nothing to schedule — the log persists for the whole match.
        if (!Number.isFinite(this.itemTTL)) {
            this.expireTimer = null;
            return;
        }

        if (this.items.length === 0) {
            this.expireTimer = null;
            return;
        }

        const now = Date.now();
        let nextTick = Infinity;

        this.items.forEach((item) => {
            if (!item || !item.expiresAt) return;
            if (item.expiresAt <= now) return;

            const expiringAt = item.expiresAt - 1000;
            if (expiringAt > now) {
                nextTick = Math.min(nextTick, expiringAt);
            }
            nextTick = Math.min(nextTick, item.expiresAt);
        });

        if (!Number.isFinite(nextTick)) {
            this.expireTimer = null;
            return;
        }

        const delay = Math.max(0, nextTick - now);

        this.expireTimer = setTimeout(() => {
            this.expireTimer = null;
            this.render();
            this._scheduleExpire();
        }, delay);
    }

    /**
     * Escape HTML
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || 'Unknown';
        return div.innerHTML;
    }

    /**
     * Clear the feed
     */
    clear() {
        this.items = [];
        this._recentKeys?.clear();
        if (this.expireTimer) {
            clearTimeout(this.expireTimer);
            this.expireTimer = null;
        }
        if (this.listContainer) {
            this.listContainer.innerHTML = '';
        }
    }

    /**
     * Clean up
     */
    destroy() {
        this.clear();
    }
}
