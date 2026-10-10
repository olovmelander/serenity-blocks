import { resolveHubThemeThumbnailUrl } from './theme-thumbnail-manifest.js';
import { getThemeMusic } from '../../core/progression/theme-music-catalog.js';
import { csIcon } from '../components/cosmic-icons.js';

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

const HELD_IN_ORB = 'Finish or leave this orb to change your theme.';

export function getCollectionPersistenceMessage(collection) {
    return PERSISTENCE_MESSAGES[collection?.getPersistenceStatus?.()?.status] || '';
}

export function filterCollectionThemeIds(ids, collection, filter = 'all') {
    if (!collection || filter === 'all') return ids;
    return ids.filter((id) => collection.isUnlocked(id) === (filter === 'owned'));
}

/** Every world open: the Hub without a collection service has nothing to earn and nothing new. */
export function createOpenCollection(themes) {
    return {
        isUnlocked: () => true,
        getOwnedThemeIds: () => themes.map((theme) => theme.id),
        getSummary: () => ({ owned: themes.length, total: themes.length, newCount: 0 }),
        getThemeStatus: (themeId) => ({ themeId, owned: true, isNew: false }),
        markSeen() {},
        subscribe: () => () => {},
    };
}

/** Where a world is found, short enough for a card: "Odyssey orb 41". */
export function getRequirementShortLabel(requirement) {
    if (requirement?.type === 'orb' && requirement.levelId) return `Odyssey orb ${requirement.levelId}`;
    return 'Not collected yet';
}

export function getCollectionCardPresentation(theme, collection, currentTheme) {
    const status = collection?.getThemeStatus(theme.id) || { owned: true, isNew: false };
    const current = status.owned && theme.id === currentTheme;
    let label = 'Collected';
    if (!status.owned) label = 'Locked';
    else if (status.developmentAccess) label = 'Development access';
    else if (status.isNew) label = 'New';
    else if (current) label = 'Current';
    return {
        ...status,
        current,
        label,
        requirement: status.requirement?.label || 'Continue your Odyssey journey to discover this world.',
        requirementShort: getRequirementShortLabel(status.requirement),
        requirementType: status.requirement?.type || null,
        accessibleLabel: `${theme.displayName}, ${label.toLowerCase()}. View theme details`,
    };
}

/**
 * Collection presentation stays local to the Hub; ownership belongs to its injected service.
 *
 * The tab's featured world is drawn here: the theme that is on, or one being looked at. Choosing
 * a card only shows it; the action bar under it applies a collected world or leads to its orb.
 */
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
        /** A world being looked at; null while the featured world follows the one that is on. */
        this.detailThemeId = null;
        /** The theme a switch is loading, so its button cannot be pressed twice. */
        this.applyingThemeId = null;
        this.feedback = '';
        this.dirty = false;
        this.unsubscribe = collection.subscribe(() => {
            this.dirty = true;
            if (tab.active) this.refresh();
        });
    }

    /** The featured world. updateDetail() fills it in. */
    renderHero() {
        return `<section class="themes-lib__hero" aria-labelledby="theme-detail-title">
                <div class="themes-lib__hero-art" aria-hidden="true">
                    <span class="themes-lib__hero-pic"></span>
                    <span class="themes-lib__hero-seal">${THEME_LOCK_ICON}<span>Not collected yet</span></span>
                </div>
                <div class="themes-lib__hero-body">
                    <span class="themes-lib__eyebrow"></span>
                    <h3 class="themes-lib__name" id="theme-detail-title"></h3>
                    <p class="themes-lib__description"></p>
                    <p class="themes-lib__song">${csIcon('note', 14)}<span class="themes-lib__song-text"></span></p>
                    <p class="themes-lib__note" id="theme-detail-note" hidden></p>
                </div>
            </section>`;
    }

    /**
     * The featured world's actions. The bar stays at the top of the tab while the grid scrolls,
     * so its line names the world it acts on. `trailing` is the tab's own control (Random).
     */
    renderBar(trailing = '') {
        return `<div class="themes-lib__bar">
                <button type="button" class="sb-btn sb-btn--primary themes-lib__use" data-collection-apply></button>
                <button type="button" class="sb-btn sb-btn--primary themes-lib__explore" data-collection-explore
                    aria-describedby="theme-detail-note" hidden>
                    Continue Odyssey <span aria-hidden="true">→</span></button>
                <p class="themes-lib__line" role="status" aria-live="polite">
                    <b class="themes-lib__line-name"></b>
                    <span class="themes-lib__line-fact"></span>
                    <span class="themes-lib__feedback"></span>
                </p>
                ${trailing}
            </div>`;
    }

    /**
     * The grid's heading: how much of the collection is yours, how the rest is found, and the
     * collection's progress as a row of tiles, one for every world.
     */
    renderHeader() {
        const {
            owned, total, newCount, developmentUnlockAll,
        } = this.collection.getSummary();
        this.renderedOwned = owned;
        const cells = Array.from({ length: total }, (_, index) => (
            `<i${index < owned ? ' class="is-filled"' : ''}></i>`)).join('');
        return `<h3 class="themes-lib__heading" id="theme-collection-title">Worlds <small>
                <span><strong data-collection-owned>${owned}</strong>
                    of ${total} ${developmentUnlockAll ? 'available' : 'collected'}</span>
                <span data-collection-note>${this.collectionNote()}</span>
                <span class="themes-lib__new" data-collection-new ${newCount ? '' : 'hidden'}>
                    ${newCount || 0} new ${newCount === 1 ? 'world' : 'worlds'} to explore</span>
            </small></h3>
            <div class="sb-meter theme-collection__progress" role="progressbar" data-collection-progress
                aria-label="Themes ${developmentUnlockAll ? 'available' : 'collected'}"
                aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${owned}"
                aria-valuetext="${owned} of ${total}">${cells}</div>`;
    }

    renderFilters() {
        const { developmentUnlockAll } = this.collection.getSummary();
        return `<div class="theme-collection__filters" role="group" aria-label="Collection">
                ${COLLECTION_FILTERS.map(([id, label]) => `<button type="button" class="collection-filter"
                    data-collection-filter="${id}" aria-pressed="${this.filter === id}">
                    ${developmentUnlockAll && id === 'owned' ? 'Available' : label}</button>`).join('')}
            </div>`;
    }

    /** Messages that belong to the collection: a failed save, and what the filters now show. */
    renderStatus() {
        return `<p class="theme-collection__save-status" data-collection-save-status role="status" hidden></p>
            <p class="hub-sr-only" data-collection-status role="status" aria-live="polite"></p>`;
    }

    collectionNote() {
        const summary = this.collection.getSummary();
        if (summary.developmentUnlockAll) {
            return `Temporary development access via unlockAll=1. ${summary.earned} / ${summary.total} collected. `
                + 'Remove the URL option to restore locks.';
        }
        if (summary.owned >= summary.total) return 'Every world is yours';
        return 'Finish an Odyssey orb to bring its world and its song home';
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
        const progress = container?.querySelector('[data-collection-progress]');
        if (progress && this.renderedOwned !== owned) {
            // One tile for every world; the collected ones are lit.
            this.renderedOwned = owned;
            progress.setAttribute('aria-valuenow', String(owned));
            progress.setAttribute('aria-valuetext', `${owned} of ${total}`);
            Array.from(progress.children || []).forEach((cell, index) => {
                cell.classList.toggle('is-filled', index < owned);
            });
        }
        const note = container?.querySelector('[data-collection-note]');
        if (note) note.textContent = this.collectionNote();
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
            const meta = card.querySelector('.theme-meta');
            if (meta) meta.textContent = this.cardMeta(theme, state);
        });
        const random = container?.querySelector('#random-theme-btn');
        if (random) {
            const inOrb = this.tab.themeManager.isOdysseyThemeScopeActive?.() === true;
            random.disabled = inOrb || this.collection.getOwnedThemeIds().length < 2;
            random.title = '';
            if (inOrb) random.title = HELD_IN_ORB;
            else if (random.disabled) random.title = 'Collect another world in Odyssey to try a random theme.';
        }
        this.tab.refreshThemeGrid();
        this.updateDetail();
    }

    /** A card's second line: its group once collected, where it is found until then. */
    cardMeta(theme, state) {
        return state.owned ? this.tab.getCategoryDisplayName(theme.group) : state.requirementShort;
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

    /** The featured world: the one being looked at, else the one that is on. */
    shownThemeId() {
        const has = (id) => this.tab.themes.some((theme) => theme.id === id);
        if (has(this.detailThemeId)) return this.detailThemeId;
        return has(this.tab.currentTheme) ? this.tab.currentTheme : this.tab.themes[0]?.id;
    }

    /**
     * Look at a world. Nothing is applied and nothing moves: the featured world changes in
     * place, and its action bar stays in reach while the grid scrolls.
     */
    open(themeId) {
        if (!this.tab.themes.some((theme) => theme.id === themeId)) return false;
        this.detailThemeId = themeId;
        this.feedback = '';
        this.collection.markSeen(themeId);
        this.updateDetail();
        return true;
    }

    /** Whether pressing "Use this theme" would switch to `themeId` now. */
    canApply(themeId = this.shownThemeId()) {
        return this.collection.isUnlocked(themeId)
            && themeId !== this.tab.currentTheme
            && this.applyingThemeId === null
            && this.tab.themeManager.canSelectTheme?.(themeId) !== false
            && this.tab.themeManager.isOdysseyThemeScopeActive?.() !== true;
    }

    /** Fill in the featured world and its bar, keeping the list where the reader has it. */
    updateDetail() {
        if (typeof this.tab.holdGridPlace === 'function') this.tab.holdGridPlace(() => this.drawDetail());
        else this.drawDetail();
    }

    drawDetail() {
        const container = this.tab.tabContainer;
        const theme = this.tab.themes.find((entry) => entry.id === this.shownThemeId());
        const hero = container?.querySelector('.themes-lib__hero');
        if (!theme || !hero) return;
        const state = getCollectionCardPresentation(theme, this.collection, this.tab.currentTheme);
        const route = this.getRouteAvailability();
        const held = this.tab.themeManager.isOdysseyThemeScopeActive?.() === true;
        const applying = this.applyingThemeId === theme.id;
        const category = this.tab.getCategoryDisplayName(theme.group);
        const icon = resolveHubThemeThumbnailUrl(theme.id);
        const song = getThemeMusic(theme.id);

        hero.dataset.theme = theme.id;
        hero.dataset.group = theme.group || '';
        hero.classList.toggle('is-locked', !state.owned);
        const bar = container.querySelector('.themes-lib__bar');
        if (bar) {
            bar.dataset.group = theme.group || '';
            let standingId = 'locked';
            if (state.current) standingId = 'current';
            else if (state.owned) standingId = 'owned';
            bar.dataset.state = standingId;
        }
        const picture = container.querySelector('.themes-lib__hero-pic');
        if (picture && picture.dataset.theme !== theme.id) {
            picture.dataset.theme = theme.id;
            picture.style.backgroundImage = icon ? `url('${icon}')` : '';
        }

        let standing = 'Collected';
        if (!state.owned) standing = state.requirementShort;
        else if (state.developmentAccess) standing = 'Development access';
        else if (state.current) standing = 'Current theme';
        else if (state.isNew) standing = 'New in your collection';
        this.write('.themes-lib__eyebrow', category ? `${category} · ${standing}` : standing);
        this.write('.themes-lib__name', theme.displayName);

        let copy = state.requirement;
        if (!state.owned && state.requirementType === 'orb') copy += ' Finishing it is enough: no stars required.';
        if (state.developmentAccess) {
            copy = `This world is temporarily available through the URL option. ${state.requirement}`;
        } else if (state.current) {
            copy = 'The world you are playing in. It stays your background in every mode until you choose another.';
        } else if (state.owned) {
            copy = 'This world is yours. Use it and it becomes your background in every mode.';
        }
        this.write('.themes-lib__description', copy);

        let songLine = '';
        if (song && state.developmentAccess) songLine = `Song available temporarily · ${song.name}`;
        else if (song && state.owned) songLine = `Song collected · ${song.name} · Yours in Music`;
        else if (song) songLine = `Song included · ${song.name}`;
        this.write('.themes-lib__song-text', songLine);
        const songRow = container.querySelector('.themes-lib__song');
        if (songRow) songRow.hidden = !songLine;

        const apply = container.querySelector('[data-collection-apply]');
        if (apply) {
            let label = 'Use this theme';
            if (state.current) label = 'Current theme';
            else if (applying) label = 'Bringing it in…';
            if (apply.textContent !== label) apply.textContent = label;
            apply.hidden = !state.owned;
            // Not `disabled`: the button keeps keyboard focus as it turns into "Current theme".
            // As that label it is no longer a stop for Tab or for a pad's D-pad (`readonly`).
            apply.classList.toggle('is-current', state.current);
            apply.classList.toggle('readonly', state.current);
            apply.tabIndex = state.current ? -1 : 0;
            apply.setAttribute('aria-disabled', String(!this.canApply(theme.id)));
            apply.setAttribute('aria-busy', String(applying));
        }
        const explore = container.querySelector('[data-collection-explore]');
        if (explore) {
            explore.hidden = state.owned;
            explore.disabled = !route.allowed;
        }

        // Why the way to Odyssey is closed from here (a game in progress) sits with the words;
        // the bar keeps saying which orb, the fact worth having while the grid scrolls.
        const routeNote = !state.owned && !route.allowed ? route.reason : '';
        this.write('.themes-lib__note', routeNote);
        const note = container.querySelector('.themes-lib__note');
        if (note) note.hidden = !routeNote;

        let fact = state.requirement;
        if (state.current) fact = 'On in every mode';
        else if (state.owned && held) fact = HELD_IN_ORB;
        else if (state.owned) fact = state.isNew ? 'New in your collection' : 'Collected';
        this.write('.themes-lib__line-name', theme.displayName);
        this.write('.themes-lib__line-fact', fact);
        this.write('.themes-lib__feedback', this.feedback);
        this.tab.updateThemeSelection?.();
    }

    /** Write text only when it changes, so a live region speaks once. */
    write(selector, text) {
        const element = this.tab.tabContainer?.querySelector(selector);
        if (element && element.textContent !== text) element.textContent = text;
    }

    /** Back to the world that is on (the tab was left, or a theme changed from elsewhere). */
    showCurrent() {
        if (this.detailThemeId === null && !this.feedback) return;
        this.detailThemeId = null;
        this.feedback = '';
        if (this.tab.active && !this.tab.destroyed) this.updateDetail();
    }

    /** Use the featured world. Ownership and the orb hold are checked again here. */
    async apply() {
        const id = this.shownThemeId();
        if (!this.canApply(id)) return false;
        this.applyingThemeId = id;
        this.feedback = '';
        this.updateDetail();
        try {
            await this.tab.selectTheme(id);
        } finally {
            this.applyingThemeId = null;
        }
        if (this.tab.destroyed) return true;
        const applied = this.tab.themeManager.activeThemeName === id;
        // A failed switch keeps the world in view, with its button ready to try again.
        this.detailThemeId = applied ? null : id;
        this.feedback = applied ? 'Theme applied.'
            : 'The theme could not be applied. Your current world is still selected.';
        this.updateDetail();
        return true;
    }

    async handleAction(target) {
        const filter = target.closest('[data-collection-filter]');
        if (filter) { this.setFilter(filter.dataset.collectionFilter); return true; }
        if (target.closest('[data-collection-apply]')) { await this.apply(); return true; }
        if (target.closest('[data-collection-explore]')) {
            const id = this.shownThemeId();
            if (!this.collection.isUnlocked(id) && this.getRouteAvailability().allowed) {
                await this.context.onExploreTheme(id);
            }
            return true;
        }
        return false;
    }

    destroy() {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
