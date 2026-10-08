import { resolveHubThemeThumbnailUrl } from './theme-thumbnail-manifest.js';
import { scrollHubElementIntoView } from './hub-scroll-utils.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export const COLLECTION_FILTERS = [
    ['all', 'All worlds'], ['owned', 'Collected'], ['locked', 'To discover'],
];

export const THEME_LOCK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3"/>'
    + '<path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></svg>';

const PERSISTENCE_MESSAGES = {
    'write-failed': 'Your collection could not be saved yet. Reopen Themes to retry.',
    'backup-failed': 'Your collection save needs recovery. It has been preserved; reopen Themes to retry.',
    'storage-unavailable': 'Your collection save is unavailable. Reopen Themes to retry when storage is available.',
    'unsupported-version': 'This collection was saved by a newer game version. Update the game to use it.',
};

export function getCollectionPersistenceMessage(collection) {
    return PERSISTENCE_MESSAGES[collection?.getPersistenceStatus?.()?.status] || '';
}

export function filterCollectionThemeIds(ids, collection, filter = 'all') {
    if (!collection || filter === 'all') return ids;
    return ids.filter((id) => collection.isUnlocked(id) === (filter === 'owned'));
}

export function getCollectionCardPresentation(theme, collection, currentTheme) {
    const status = collection?.getThemeStatus(theme.id) || { owned: true, isNew: false };
    const current = status.owned && theme.id === currentTheme;
    let label = 'Collected';
    if (!status.owned) label = 'Locked';
    else if (status.isNew) label = 'New';
    else if (current) label = 'Current';
    return {
        ...status,
        current,
        label,
        requirement: status.requirement?.label || 'Continue your Odyssey journey to discover this world.',
        accessibleLabel: `${theme.displayName}, ${label.toLowerCase()}. View theme details`,
    };
}

/** Collection presentation stays local to the Hub; ownership belongs to its injected service. */
export class ThemeCollectionView {
    constructor(tab, collection, context = {}) {
        this.tab = tab;
        this.collection = collection;
        this.context = context;
        this.filter = 'all';
        this.cardOrder = new Map([...tab.themes].sort((left, right) => {
            const leftOwned = collection.isUnlocked(left.id);
            const rightOwned = collection.isUnlocked(right.id);
            if (leftOwned !== rightOwned) return Number(rightOwned) - Number(leftOwned);
            return left.displayName.localeCompare(right.displayName);
        }).map((theme, index) => [theme.id, index]));
        this.detailThemeId = null;
        this.dirty = false;
        this.unsubscribe = collection.subscribe(() => {
            this.dirty = true;
            if (tab.active) this.refresh();
        });
    }

    renderHeader() {
        const { owned, total, newCount } = this.collection.getSummary();
        return `<section class="theme-collection" aria-labelledby="theme-collection-title">
            <div class="theme-collection__heading">
                <div><p class="sb-eyebrow">Worlds you bring home</p>
                    <h3 id="theme-collection-title">Your collection</h3></div>
                <p class="theme-collection__count"><strong data-collection-owned>${owned}</strong>
                    <span>of ${total} collected</span></p>
            </div>
            <progress class="theme-collection__progress" value="${owned}" max="${total}"
                aria-label="Themes collected">${owned} of ${total}</progress>
            <p class="theme-collection__note">Complete Odyssey orbs to collect their worlds and songs together.</p>
            <p class="theme-collection__new" data-collection-new ${newCount ? '' : 'hidden'}>
                ${newCount || 0} new ${newCount === 1 ? 'world' : 'worlds'} to explore</p>
            <p class="theme-collection__save-status" data-collection-save-status role="status" hidden></p>
            <div class="theme-collection__filters" role="group" aria-label="Collection">
                ${COLLECTION_FILTERS.map(([id, label]) => `<button type="button" class="collection-filter"
                    data-collection-filter="${id}" aria-pressed="${this.filter === id}">${label}</button>`).join('')}
            </div>
            <p class="hub-sr-only" data-collection-status role="status" aria-live="polite"></p>
        </section>`;
    }

    filterIds(ids) {
        return filterCollectionThemeIds(ids, this.collection, this.filter);
    }

    orderThemes(themes) {
        return [...themes].sort((left, right) => this.cardOrder.get(left.id) - this.cardOrder.get(right.id));
    }

    activate() {
        this.collection.reconcileFromOdyssey?.(undefined, { silent: true });
        this.refresh();
    }

    setFilter(filter) {
        if (!COLLECTION_FILTERS.some(([id]) => id === filter) || filter === this.filter) return;
        this.filter = filter;
        this.tab.tabContainer.querySelectorAll('[data-collection-filter]').forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.collectionFilter === filter));
        });
        this.tab.refreshThemeGrid();
        this.announce(`${this.filterIds(this.tab.getVisibleThemeIds('all')).length} themes shown.`);
    }

    refresh() {
        if (!this.tab.active || this.tab.destroyed) { this.dirty = true; return; }
        this.dirty = false;
        const { owned, total, newCount } = this.collection.getSummary();
        const container = this.tab.tabContainer;
        const count = container?.querySelector('[data-collection-owned]');
        if (count) count.textContent = owned;
        const progress = container?.querySelector('.theme-collection__progress');
        if (progress) { progress.value = owned; progress.max = total; }
        const newlyCollected = container?.querySelector('[data-collection-new]');
        if (newlyCollected) {
            newlyCollected.hidden = !newCount;
            newlyCollected.textContent = `${newCount || 0} new ${newCount === 1 ? 'world' : 'worlds'} to explore`;
        }
        const saveStatus = container?.querySelector('[data-collection-save-status]');
        if (saveStatus) {
            const message = getCollectionPersistenceMessage(this.collection);
            if (saveStatus.textContent !== message) saveStatus.textContent = message;
            saveStatus.hidden = !message;
        }
        this.tab.themeCardElements.forEach((card, id) => {
            const theme = this.tab.themes.find((entry) => entry.id === id);
            if (!theme) return;
            const state = getCollectionCardPresentation(theme, this.collection, this.tab.currentTheme);
            card.classList.toggle('is-locked', !state.owned);
            card.classList.toggle('is-new', Boolean(state.isNew));
            card.setAttribute('aria-label', state.accessibleLabel);
            const status = card.querySelector('.theme-collection-state');
            if (status) status.textContent = state.label;
            const requirement = card.querySelector('.theme-unlock-requirement');
            if (requirement) requirement.textContent = state.owned ? 'Available in every mode' : state.requirement;
        });
        const random = container?.querySelector('#random-theme-btn');
        if (random) {
            const inOrb = this.tab.themeManager.isOdysseyThemeScopeActive?.() === true;
            random.disabled = inOrb || this.collection.getOwnedThemeIds().length < 2;
            random.title = '';
            if (inOrb) random.title = 'Finish or leave this orb to change your theme.';
            else if (random.disabled) random.title = 'Collect another world in Odyssey to try a random theme.';
        }
        this.tab.refreshThemeGrid();
        if (this.detailThemeId) this.updateDetail();
    }

    announce(message) {
        const status = this.tab.tabContainer?.querySelector('[data-collection-status]');
        if (status) status.textContent = message;
    }

    getRouteAvailability() {
        if (typeof this.context.onExploreTheme !== 'function') {
            return { allowed: false, reason: 'Return to the main menu to continue your Odyssey.' };
        }
        const availability = this.context.canExploreTheme?.();
        if (availability === true) return { allowed: true };
        if (availability?.allowed === true) return availability;
        return {
            allowed: false,
            reason: availability?.reason || 'Return to the main menu to continue your Odyssey.',
        };
    }

    open(themeId) {
        if (!this.tab.themes.some((theme) => theme.id === themeId)) return false;
        this.detailThemeId = themeId;
        this.browseScrollTop = this.tab.hub.getScrollContainer?.()?.scrollTop || 0;
        this.collection.markSeen(themeId);
        this.updateDetail();
        const container = this.tab.tabContainer;
        container.querySelector('.themes-collection-browse').hidden = true;
        container.querySelector('.theme-collection-detail').hidden = false;
        const scroller = this.tab.hub.getScrollContainer?.();
        if (scroller) scroller.scrollTop = 0;
        container.querySelector('#theme-detail-title')?.focus();
        return true;
    }

    updateDetail() {
        const theme = this.tab.themes.find((entry) => entry.id === this.detailThemeId);
        const detail = this.tab.tabContainer?.querySelector('.theme-collection-detail');
        if (!theme || !detail) return;
        const previousFocus = globalThis.document?.activeElement;
        const ownedFocus = previousFocus && detail.contains(previousFocus);
        const focusAction = ['back', 'apply', 'explore'].find((action) => (
            previousFocus?.matches?.(`[data-collection-${action}]`)
        ));
        const state = getCollectionCardPresentation(theme, this.collection, this.tab.currentTheme);
        const route = this.getRouteAvailability();
        const applyHeld = this.tab.themeManager.isOdysseyThemeScopeActive?.() === true;
        const icon = resolveHubThemeThumbnailUrl(theme.id);
        const song = getThemeMusic(theme.id);
        detail.innerHTML = `<button type="button" class="sb-btn theme-detail-back" data-collection-back>
                <span aria-hidden="true">←</span> Collection</button>
            <div class="theme-detail-stage${state.owned ? '' : ' is-locked'}" data-group="${theme.group || ''}">
                <div class="theme-detail-halo" aria-hidden="true"></div>
                ${icon ? `<img class="theme-detail-art" src="${escapeHtml(icon)}" alt="" />` : ''}
                <span class="theme-detail-seal">${state.owned ? 'Collected' : `${THEME_LOCK_ICON} Locked`}</span>
            </div>
            <div class="theme-detail-copy">
                <p class="sb-eyebrow">${escapeHtml(this.tab.getCategoryDisplayName(theme.group))}</p>
                <h3 id="theme-detail-title" tabindex="-1">${escapeHtml(theme.displayName)}</h3>
                <p class="theme-detail-requirement">${state.owned
        ? 'This world is yours. Bring it into your next game or a quiet moment in Serenity.'
        : escapeHtml(state.requirement)}</p>
                <p class="theme-detail-note">${state.owned
        ? 'Choosing a theme keeps it as your preferred background.'
        : 'Complete this requirement to bring the world home. No stars required.'}
                    ${song ? `<span class="theme-detail-song">${state.owned ? 'Song collected' : 'Song included'}
                        · ${escapeHtml(song.name)}${state.owned ? ' · Yours in Music' : ''}</span>` : ''}</p>
                ${state.owned
        ? `<button type="button" class="sb-btn sb-btn--primary" data-collection-apply
                    ${state.current || applyHeld ? 'disabled' : ''}>
                    ${state.current ? 'Current theme' : 'Apply theme'}</button>
                ${applyHeld ? '<p class="theme-detail-route-note">'
            + 'Finish or leave this orb to change your theme.</p>' : ''}`
        : `<button type="button" class="sb-btn sb-btn--primary" data-collection-explore
                    ${route.allowed ? '' : 'disabled'}>Continue Odyssey <span aria-hidden="true">→</span></button>
                ${route.allowed ? '' : `<p class="theme-detail-route-note">${escapeHtml(route.reason)}</p>`}`}
                <p class="theme-detail-feedback" role="status" aria-live="polite"></p>
            </div>`;
        if (ownedFocus) {
            const sameAction = focusAction && detail.querySelector(`[data-collection-${focusAction}]:not([disabled])`);
            const focusTarget = sameAction || detail.querySelector('#theme-detail-title');
            focusTarget?.focus({ preventScroll: true });
        }
    }

    close({ restoreFocus = true } = {}) {
        if (!this.detailThemeId) return false;
        const themeId = this.detailThemeId;
        this.detailThemeId = null;
        const container = this.tab.tabContainer;
        container.querySelector('.theme-collection-detail').hidden = true;
        container.querySelector('.themes-collection-browse').hidden = false;
        const scroller = this.tab.hub.getScrollContainer?.();
        if (scroller) scroller.scrollTop = this.browseScrollTop || 0;
        if (restoreFocus) {
            const card = this.tab.themeCardElements.get(themeId);
            if (card && !card.hidden) {
                card.focus({ preventScroll: true });
                scrollHubElementIntoView(card);
            } else {
                container.querySelector('[data-collection-filter]')?.focus();
            }
        }
        this.tab.hydrateVisibleThemeCardIcons();
        return true;
    }

    async handleAction(target) {
        const filter = target.closest('[data-collection-filter]');
        if (filter) { this.setFilter(filter.dataset.collectionFilter); return true; }
        if (target.closest('[data-collection-back]')) return this.close();
        if (target.closest('[data-collection-apply]')) {
            const id = this.detailThemeId;
            if (!this.collection.isUnlocked(id) || this.tab.themeManager.canSelectTheme?.(id) === false) return true;
            await this.tab.selectTheme(id);
            if (this.tab.destroyed || this.detailThemeId !== id) return true;
            this.updateDetail();
            const feedback = this.tab.tabContainer.querySelector('.theme-detail-feedback');
            if (feedback) {
                feedback.textContent = this.tab.themeManager.activeThemeName === id
                    ? 'Theme applied.' : 'The theme could not be applied. Your current world is still selected.';
            }
            this.tab.tabContainer.querySelector('[data-collection-back]')?.focus();
            return true;
        }
        if (target.closest('[data-collection-explore]')) {
            if (this.getRouteAvailability().allowed) await this.context.onExploreTheme(this.detailThemeId);
            return true;
        }
        return false;
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
