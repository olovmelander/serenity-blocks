/**
 * OnlineKillFeed - Battle log component for online multiplayer
 *
 * Shows recent kills/deaths and combat events in chronological order
 */
export class OnlineKillFeed {
    constructor(container) {
        this.container = container;
        this.listContainer = null;
        this.maxItems = 10;
        this.itemTTL = 5000;
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
     * Add a kill event to the feed
     * @param {Object} event - { killer: string, victim: string, linesCleared?: number }
     */
    addKill(event) {
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

        // Limit to max items
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

        if (this.items.length === 0) {
            this.expireTimer = null;
            return;
        }

        const now = Date.now();
        const nextExpiry = this.items.reduce((min, item) => Math.min(min, item.expiresAt), Infinity);
        const delay = Math.max(0, nextExpiry - now);

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
