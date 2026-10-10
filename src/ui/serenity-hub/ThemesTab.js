/**
 * ThemesTab - the library of worlds to play in.
 *
 * The same shape as the Breathing tab: one featured world (the theme that is on, or one you are
 * looking at) with its action bar, then every world as artwork. Choosing a card shows it in
 * place; "Use this theme" (or the chosen card pressed again) applies it. Worlds not collected yet
 * are shown, not hidden, with the orb that brings them home. The bar stays at the top while the
 * grid scrolls, so nothing jumps and the action is always in reach.
 *
 * Ownership comes from the theme collection (ThemeCollectionView draws the featured world, the
 * heading and the collection filter); this file owns the grid, search, categories, thumbnail
 * hydration and Tornado's live controls.
 */

import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { TORNADO_PARAM_DEFAULTS, TORNADO_PARAM_RANGES } from '../../themes/tornado/params.ts';
import { performanceMonitor } from '../../utils/performance-monitor.js';
import {
    resolveDesktopHubThemeThumbnailUrl,
    resolveHubThemeThumbnailUrl,
} from './theme-thumbnail-manifest.js';
import { initThemeCardInteractions } from './theme-card-interactions.js';
import { csIcon } from '../components/cosmic-icons.js';
import {
    ThemeCollectionView, createOpenCollection, getCollectionCardPresentation, THEME_LOCK_ICON,
} from './ThemeCollectionView.js';

const CURRENT_LABEL = 'Current';

/** Tornado's live parameters, in words (the keys stay the settings' own). */
const PARAM_LABELS = Object.freeze({
    emissiveColor: 'Storm light',
    timeScale: 'Wind speed',
    ribbonWidth: 'Funnel girth',
    parabolaStrength: 'Rope sway',
    parabolaOffset: 'Lean',
    parabolaAmplitude: 'Cloud flare',
    bloomStrength: 'Bloom',
    bloomRadius: 'Bloom radius',
});

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

/** What each theme group is called on screen (the chips, each card, and search). */
export const CATEGORY_LABELS = Object.freeze({
    biomes: 'Nature',
    cosmic: 'Cosmic',
    meditation: 'Meditation',
    urban: 'Urban',
    fantasy: 'Fantasy',
    abstract: 'Abstract',
    sky: 'Sky',
    atmospheric: 'Atmospheric',
});

/**
 * Theme ids in a category whose name, group id or category label holds the query —
 * so "nature" finds the Nature themes even though their group id is "biomes".
 */
export function getFilteredThemeIds(themes, selectedCategory = 'all', searchQuery = '', labels = CATEGORY_LABELS) {
    let filteredThemes = selectedCategory === 'all'
        ? themes
        : themes.filter((theme) => theme.group === selectedCategory);

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery) {
        filteredThemes = filteredThemes.filter((theme) => (
            theme.displayName.toLowerCase().includes(normalizedQuery)
            || (theme.group && theme.group.toLowerCase().includes(normalizedQuery))
            || (theme.group && labels[theme.group]?.toLowerCase().includes(normalizedQuery))
        ));
    }

    return [...filteredThemes]
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
        .map((theme) => theme.id);
}

export function applyThemeCardFilter(cards, visibleThemeIds) {
    const visibleIdSet = new Set(visibleThemeIds);
    let visibleCount = 0;

    cards.forEach((card) => {
        const isVisible = visibleIdSet.has(card?.dataset?.theme);
        const hidden = !isVisible;
        const ariaHidden = String(hidden);
        if (card.hidden !== hidden) card.hidden = hidden;
        if (card.getAttribute?.('aria-hidden') !== ariaHidden) card.setAttribute?.('aria-hidden', ariaHidden);
        const tabIndex = isVisible ? 0 : -1;
        if ('tabIndex' in card && card.tabIndex !== tabIndex) card.tabIndex = tabIndex;
        if (card.classList?.contains?.('is-filtered-out') !== hidden) {
            card.classList?.toggle?.('is-filtered-out', hidden);
        }
        if (isVisible) {
            visibleCount += 1;
        }
    });

    return visibleCount;
}

export function createThemeIconObserverOptions(scrollContainer = null) {
    return {
        root: scrollContainer ?? null,
        rootMargin: '180px 0px',
        threshold: 0.01,
    };
}

function getCardIcons(card) {
    return Array.from(card?.querySelectorAll?.('.theme-icon-img[data-theme-icon-src]') || []);
}

function getViewportRect(scrollContainer = null) {
    const fallbackHeight = globalThis.window?.innerHeight || 900;
    if (!scrollContainer?.getBoundingClientRect) {
        return {
            top: 0,
            bottom: fallbackHeight,
        };
    }

    const rect = scrollContainer.getBoundingClientRect();
    return {
        top: rect.top,
        bottom: rect.bottom,
    };
}

export function getThemeIconHydrationPlan(cards, { scrollContainer = null } = {}) {
    const visibleCards = cards.filter((card) => !card?.hidden);
    if (visibleCards.length === 0) {
        return {
            immediateIcons: [],
            deferredIcons: [],
        };
    }

    const viewportRect = getViewportRect(scrollContainer);
    const cardsWithRects = visibleCards.map((card) => ({
        card,
        rect: card?.getBoundingClientRect?.() || null,
    }));

    const visibleRowCards = cardsWithRects.filter(({ rect }) => (
        rect
        && rect.bottom > viewportRect.top
        && rect.top < viewportRect.bottom
    ));
    const prioritizedCards = visibleRowCards.length > 0 ? visibleRowCards : cardsWithRects.slice(0, 6);
    const firstRowTop = prioritizedCards[0]?.rect?.top ?? cardsWithRects[0]?.rect?.top ?? 0;
    const immediateCards = prioritizedCards
        .filter(({ rect }, index) => index === 0 || !rect || Math.abs(rect.top - firstRowTop) <= 24)
        .map(({ card }) => card);
    const immediateCardSet = new Set(immediateCards);

    return {
        immediateIcons: immediateCards.flatMap((card) => getCardIcons(card)),
        deferredIcons: visibleCards
            .filter((card) => !immediateCardSet.has(card))
            .flatMap((card) => getCardIcons(card)),
    };
}

export function shouldUseDesktopThemeThumbnails() {
    // Always use bundled Vite-resolved icons. The desktop path constructs URLs
    // via new URL() which produces malformed paths on file:// protocol in
    // packaged Electron builds, causing cascading load failures and slow icon
    // rendering. Bundled assets are already local files — no benefit to the
    // desktop path.
    return false;
}

export function resolveThemeIconHydrationSource(
    icon,
    runtimeConfig = globalThis.window?.desktopRuntimeConfig,
) {
    const bundledSrc = icon?.dataset?.themeIconSrc || null;
    const desktopSrc = shouldUseDesktopThemeThumbnails(runtimeConfig)
        ? (icon?.dataset?.themeDesktopIconSrc || null)
        : null;

    return {
        src: desktopSrc || bundledSrc,
        source: desktopSrc ? 'desktop' : 'bundled',
    };
}

export class ThemesTab {
    constructor(hubInstance, themeManager, settingsManager) {
        this.hub = hubInstance;
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;
        this.serenityMode = hubInstance.serenityMode;

        this.themes = THEME_REGISTRY;
        this.currentTheme = this.themeManager.activeThemeName;
        this.selectedCategory = 'all';
        this.searchQuery = '';
        const context = this.serenityMode?.deps || {};
        // Without a collection service every world is simply open.
        const collection = context.themeCollection || themeManager.themeCollection || createOpenCollection(this.themes);
        this.collectionView = new ThemeCollectionView(this, collection, context);

        // Group themes by category
        this.categories = this.getCategories();
        this.themeParamInputHandler = (event) => this.handleThemeParamInput(event);
        this.tabContainer = null;
        this.tabClickHandler = null;
        this.tabKeydownHandler = null;
        this.themeSelectionGeneration = 0;
        this.searchInputHandler = null;
        this.debouncedSearchHandler = null;
        this.iconObserver = null;
        this.iconLoadHandler = null;
        this.iconErrorHandler = null;
        this.iconReadyRecorder = null;
        this.hubIconsReadyRecorded = false;
        this.themeCardElements = new Map();
        this.emptyStateElement = null;
        this.searchClearButton = null;
        this.active = false;
        this.destroyed = false;
        this.renderedTheme = this.currentTheme;
        this.renderedShownTheme = this.currentTheme;
        this.paramsOpen = false;
        this.filterDirty = false;
        this.searchTimer = null;
        this.iconBatchFrame = null;
        this.domAbortController = new AbortController();

        this.init();
    }

    /**
     * Initializes the themes tab
     */
    init() {
        // Sync with current theme from theme manager
        this.currentTheme = this.themeManager.activeThemeName;

        this.render();
        this.attachEventListeners();
        this.listenForThemeChanges();
        this.setActive(this.hub.isOpen && this.hub.currentTab === 'themes' && !document.hidden);
        console.log('[ThemesTab] Initialized with', this.themes.length, 'themes, current theme:', this.currentTheme);
    }

    /**
     * Get unique categories from themes
     * @returns {Array} Array of category objects
     */
    getCategories() {
        const categorySet = new Set();
        this.themes.forEach((theme) => {
            if (theme.group) {
                categorySet.add(theme.group);
            }
        });

        const categories = [
            { id: 'all', name: 'All', count: this.themes.length },
        ];

        const label = (cat) => CATEGORY_LABELS[cat] || cat;
        Array.from(categorySet).sort((a, b) => label(a).localeCompare(label(b))).forEach((cat) => {
            const count = this.themes.filter((t) => t.group === cat).length;
            categories.push({ id: cat, name: label(cat), count });
        });

        return categories;
    }

    /**
     * Get the cosmic-icons name used as a thumbnail fallback for a theme.
     * (No emojis anywhere — these resolve to own-designed line SVGs.)
     * @param {Object} theme - Theme object with id and displayName
     * @returns {string} cosmic-icons key (see cosmic-icons.js)
     */
    getThemeFallbackIconName(theme) {
        const icons = {
            Forest: 'tree',
            'Himalayan Peak': 'mountain',
            'Ice Temple': 'snowflake',
            'Moonlit Forest': 'moon',
            Wolfhour: 'wolf',
            Ocean: 'wave',
            Sunset: 'sunrise',
            Mountain: 'mountain',
            'Zen Garden': 'bamboo',
            Winter: 'snowflake',
            Fall: 'leaf',
            Summer: 'sun',
            Tornado: 'spiral',
            Aurora: 'aurora',
            Galaxy: 'galaxy',
            'Rainy Window': 'rain',
            'Koi Pond': 'fish',
            'Cosmic Chimes': 'chime',
            'Singing Bowl': 'bowl',
            Starlight: 'star',
            'Sky Children': 'cloud',
            'Golden Forest': 'tree',
            Geode: 'gem',
            Bioluminescence: 'jellyfish',
            'Void Ember': 'flame',
            'Desert Oasis': 'island',
            'Bamboo Grove': 'bamboo',
            'Misty Lake': 'mist',
            Waves: 'wave',
            'Fluid Dreams': 'droplet',
            'Lantern Festival': 'lantern',
            'Crystal Cave': 'gem',
            'Candlelit Monastery': 'candle',
            'Cherry Blossom Garden': 'flower',
            'Floating Islands': 'island',
            'Meditation Temple': 'temple',
            'Moonlit Greenhouse': 'sprout',
            Murmuration: 'spiral',
            'Nebula Flow': 'spiral',
            Lunara: 'moon',
            Pyrestorm: 'flame',
            'Neon Dusk': 'city',
            Stillwater: 'droplet',
            Parhelion: 'sun',
        };
        return icons[theme.displayName] || 'palette';
    }

    getThemeIcon(theme) {
        const iconUrl = resolveHubThemeThumbnailUrl(theme.id);
        const desktopIconUrl = resolveDesktopHubThemeThumbnailUrl(theme.id);
        const fallbackName = this.getThemeFallbackIconName(theme);

        if (!iconUrl) {
            return `<div class="theme-icon-emoji">${csIcon(fallbackName, 40)}</div>`;
        }

        return `
            <img
                alt=""
                aria-hidden="true"
                class="theme-icon-img"
                data-theme-icon-src="${iconUrl}"
                data-theme-desktop-icon-src="${desktopIconUrl || ''}"
                data-theme-icon-fallback="${fallbackName}"
                loading="lazy"
                decoding="async"
                fetchpriority="low"
            />
        `;
    }

    /**
     * Renders the themes tab content
     */
    render() {
        const container = this.hub.panel?.querySelector('#tab-themes') || document.getElementById('tab-themes');
        this.tabContainer = container;
        if (!container) {
            console.error('[ThemesTab] Container not found');
            return;
        }

        // The featured world and its action bar (which stays in reach while the grid scrolls),
        // Tornado's live controls when Tornado is on, then the tools and every world.
        const view = this.collectionView;
        const random = `<button type="button" class="sb-btn random-theme-btn" id="random-theme-btn"
                    aria-label="Random theme">
                    ${csIcon('dice', 18)}<span class="btn-text">Random theme</span>
                </button>`;
        container.innerHTML = `
            <div class="themes-lib">
                ${view?.renderHero() || ''}
                ${view?.renderBar(random) || ''}
                <div class="theme-params" id="theme-params" hidden></div>
                <section class="themes-lib__browse" aria-labelledby="theme-collection-title">
                    ${view?.renderHeader() || ''}
                    <div class="themes-toolbar">
                        <div class="themes-control-bar">
                            <div class="themes-search-wrap" role="search">
                                <label class="hub-sr-only" for="themes-search-input">Search themes</label>
                                <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                    stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                                    <circle cx="11" cy="11" r="7"></circle>
                                    <path d="m20 20-3.6-3.6"></path>
                                </svg>
                                <input
                                    type="search"
                                    class="themes-search-input"
                                    id="themes-search-input"
                                    placeholder="Search by name or category"
                                    autocomplete="off"
                                    spellcheck="false"
                                    enterkeyhint="search"
                                />
                                <button type="button" class="themes-search-clear" aria-label="Clear search" hidden>
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
                                        stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
                                        <path d="M7 7l10 10M17 7 7 17"></path>
                                    </svg>
                                </button>
                            </div>
                            ${view?.renderFilters() || ''}
                        </div>
                        <div class="category-filter" role="group" aria-label="Categories">
                            ${this.renderCategoryFilters()}
                        </div>
                    </div>
                    ${view?.renderStatus() || ''}
                    <div class="themes-grid" id="themes-grid"></div>
                </section>
            </div>
        `;

        this.searchClearButton = container.querySelector('.themes-search-clear');
        this.populateThemeGrid();
        this.refreshThemeParams();
        view?.updateDetail();

        // A soft light follows the pointer over a card (delegated to the grid, so it survives
        // populateThemeGrid re-renders).
        initThemeCardInteractions(container);
    }

    /**
     * Render category filter pills
     * @returns {string} HTML for category filters
     */
    renderCategoryFilters() {
        return this.categories.map((cat) => {
            const pressed = cat.id === this.selectedCategory;
            return `
            <button type="button" class="category-pill${pressed ? ' active' : ''}" data-category="${cat.id}"
                    aria-pressed="${pressed}">
                <span class="pill-text">${escapeHtml(cat.name)}</span>
                <span class="pill-count">${cat.count}<span class="hub-sr-only"> themes</span></span>
            </button>`;
        }).join('');
    }

    /**
     * Get filtered and sorted themes based on current category + search query
     * @returns {Array} Filtered theme array
     */
    filterThemes() {
        const visibleThemeIds = this.getVisibleThemeIds();
        return this.themes
            .filter((theme) => visibleThemeIds.includes(theme.id))
            .sort((left, right) => left.displayName.localeCompare(right.displayName));
    }

    getVisibleThemeIds(collectionFilter = null) {
        const ids = getFilteredThemeIds(this.themes, this.selectedCategory, this.searchQuery);
        if (!this.collectionView || collectionFilter === 'all') return ids;
        return this.collectionView.filterIds(ids);
    }

    /**
     * Render theme cards
     * @returns {string} HTML for theme cards
     */
    renderThemeCards() {
        const sortedThemes = this.collectionView?.orderThemes(this.themes)
            || [...this.themes].sort((left, right) => left.displayName.localeCompare(right.displayName));

        // A card is artwork, a name and one line: its group once collected, where it is found
        // until then. The category's hue comes from data-group in keystone-hub.css. The card
        // that is on carries `active` (and the keystone); the one in the featured spot is pressed.
        const collection = this.collectionView;
        const shown = collection?.shownThemeId() ?? this.currentTheme;
        return sortedThemes.map((theme) => {
            const iconHtml = this.getThemeIcon(theme);
            const state = getCollectionCardPresentation(theme, collection?.collection, this.currentTheme);
            const isActive = theme.id === this.currentTheme && state.owned;
            const stateClasses = `${state.owned ? '' : ' is-locked'}${state.isNew ? ' is-new' : ''}`;
            const label = collection ? state.accessibleLabel : `Select ${theme.displayName} theme`;
            const meta = collection ? collection.cardMeta(theme, state) : this.getCategoryDisplayName(theme.group);

            return `
                <div class="theme-card${isActive ? ' active' : ''}${stateClasses}"
                     data-theme="${theme.id}"
                     data-group="${theme.group || ''}"
                     tabindex="0"
                     role="button"
                     aria-label="${escapeHtml(label)}"
                     aria-pressed="${theme.id === shown}"
                     aria-current="${isActive}">
                    <div class="theme-swatch">
                        ${iconHtml}
                        ${isActive ? `<span class="active-indicator">${CURRENT_LABEL}</span>` : ''}
                        <span class="theme-new-mark" aria-hidden="true">New</span>
                        <span class="theme-lock-mark" aria-hidden="true">${THEME_LOCK_ICON}</span>
                        <span class="theme-use-hint" aria-hidden="true">Press again to use</span>
                    </div>
                    <div class="theme-info">
                        <div class="theme-name">${escapeHtml(theme.displayName)}</div>
                        <div class="theme-meta">${escapeHtml(meta)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    populateThemeGrid() {
        const grid = this.tabContainer?.querySelector('#themes-grid') || document.getElementById('themes-grid');
        if (!grid) {
            return;
        }

        grid.innerHTML = `
            ${this.renderThemeCards()}
            <div class="no-themes" id="themes-empty-state" role="status" hidden>
                <p class="no-themes__title">No themes found</p>
                <p class="no-themes__note">Try another name, or show every category.</p>
                <button type="button" class="sb-btn themes-clear-filters">Clear filters</button>
            </div>
        `;
        this.themeCardElements = new Map(
            Array.from(grid.querySelectorAll('.theme-card')).map((card) => [card.dataset.theme, card]),
        );
        this.emptyStateElement = grid.querySelector('#themes-empty-state');
        const visibleThemeIds = this.getVisibleThemeIds();
        const visibleCount = applyThemeCardFilter(Array.from(this.themeCardElements.values()), visibleThemeIds);
        this.showEmptyState(visibleCount === 0);
    }

    /** The empty state names what was searched for and offers the way back. */
    showEmptyState(empty) {
        const state = this.emptyStateElement;
        if (!state) return;
        if (empty) {
            const query = this.searchQuery.trim();
            const title = state.querySelector?.('.no-themes__title');
            if (title) title.textContent = query ? `Nothing matches “${query}”` : 'No themes found';
        }
        state.hidden = !empty;
    }

    /** Empty the search field and show what the chosen category holds. */
    clearSearch({ focus = false, refresh = true } = {}) {
        const input = this.tabContainer?.querySelector('#themes-search-input');
        if (input) input.value = '';
        this.searchQuery = '';
        if (this.searchClearButton) this.searchClearButton.hidden = true;
        if (this.searchTimer !== null) clearTimeout(this.searchTimer);
        this.searchTimer = null;
        if (refresh) this.refreshThemeGrid();
        if (focus) input?.focus?.({ preventScroll: true });
    }

    /** Back to every theme: an empty search and the All chip. */
    clearFilters() {
        this.collectionView?.setFilter('all');
        this.clearSearch({ focus: true, refresh: this.selectedCategory === 'all' });
        if (this.selectedCategory !== 'all') this.selectCategory('all');
    }

    /**
     * Render theme parameter controls (Tornado only for now)
     * @returns {string} HTML for theme controls
     */
    renderThemeParams() {
        // Only Tornado has live controls; they sit under the featured world while it is on.
        if (this.currentTheme !== 'tornado') return '';

        const params = this.getTornadoParams();
        const open = this.paramsOpen === true;

        return `
            <div class="theme-params-panel">
                <button type="button" class="theme-params-toggle" aria-expanded="${open}"
                    aria-controls="theme-params-body">
                    <span class="sb-eyebrow theme-params-title">Tornado · Live controls</span>
                    <span class="theme-params-toggle__state">${open ? 'Hide' : 'Show'}</span>
                </button>
                <div class="theme-params-body" id="theme-params-body" ${open ? '' : 'hidden'}>
                    ${this.renderThemeParamColor('emissiveColor', params.emissiveColor)}
                    ${this.renderThemeParamRange('timeScale', params.timeScale)}
                    ${this.renderThemeParamRange('ribbonWidth', params.ribbonWidth)}
                    ${this.renderThemeParamRange('parabolaStrength', params.parabolaStrength)}
                    ${this.renderThemeParamRange('parabolaOffset', params.parabolaOffset)}
                    ${this.renderThemeParamRange('parabolaAmplitude', params.parabolaAmplitude)}
                    ${this.renderThemeParamRange('bloomStrength', params.bloomStrength)}
                    ${this.renderThemeParamRange('bloomRadius', params.bloomRadius)}
                </div>
            </div>
        `;
    }

    /** Open or close Tornado's controls in place (they stay as they were across refreshes). */
    toggleThemeParams() {
        this.paramsOpen = !this.paramsOpen;
        const panel = this.tabContainer?.querySelector('#theme-params');
        const toggle = panel?.querySelector('.theme-params-toggle');
        const body = panel?.querySelector('.theme-params-body');
        if (!toggle || !body) return;
        toggle.setAttribute('aria-expanded', String(this.paramsOpen));
        body.hidden = !this.paramsOpen;
        const state = toggle.querySelector('.theme-params-toggle__state');
        if (state) state.textContent = this.paramsOpen ? 'Hide' : 'Show';
    }

    renderThemeParamColor(key, value) {
        return `
            <div class="theme-param-row">
                <label class="theme-param-label" for="theme-param-${key}">${PARAM_LABELS[key] || key}</label>
                <input class="theme-param-input theme-param-color"
                       id="theme-param-${key}"
                       type="color"
                       data-theme-param="${key}"
                       value="${value}">
                <span class="theme-param-value" data-theme-param-value="${key}">${value}</span>
            </div>
        `;
    }

    renderThemeParamRange(key, value) {
        const range = TORNADO_PARAM_RANGES[key];
        const displayValue = this.formatParamValue(key, value);

        return `
            <div class="theme-param-row">
                <label class="theme-param-label" for="theme-param-${key}">${PARAM_LABELS[key] || key}</label>
                <input class="theme-param-input"
                       id="theme-param-${key}"
                       type="range"
                       min="${range.min}"
                       max="${range.max}"
                       step="${range.step}"
                       data-theme-param="${key}"
                       value="${value}">
                <span class="theme-param-value" data-theme-param-value="${key}">${displayValue}</span>
            </div>
        `;
    }

    formatParamValue(key, value) {
        if (key === 'emissiveColor') return value;
        const decimals = key === 'parabolaOffset' ? 2 : 2;
        return Number(value).toFixed(decimals);
    }

    getTornadoParams() {
        const settings = this.settingsManager.get();
        return {
            ...TORNADO_PARAM_DEFAULTS,
            ...(settings.tornadoThemeParams || {}),
        };
    }

    /**
     * Get category display name
     * @param {string} id - Category ID
     * @returns {string} Display name
     */
    getCategoryDisplayName(id) {
        const category = this.categories.find((c) => c.id === id);
        return category ? category.name : (id || '');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        this.tabContainer ||= document.getElementById('tab-themes');
        if (!this.tabContainer) {
            console.warn('[ThemesTab] Tab container not found when attaching listeners');
            return;
        }

        this.tabClickHandler = (event) => {
            const { target } = event;
            if (!target) return;
            if (this.collectionView && target.closest('[data-collection-filter], '
                + '[data-collection-apply], [data-collection-explore]')) {
                event.stopPropagation();
                this.collectionView.handleAction(target).catch((error) => {
                    console.error('[ThemesTab] Collection action failed:', error);
                });
                return;
            }

            const categoryPill = target.closest('.category-pill');
            if (categoryPill && this.tabContainer.contains(categoryPill)) {
                const { category } = categoryPill.dataset;
                if (category) {
                    this.selectCategory(category);
                }
                return;
            }

            const themeCard = target.closest('.theme-card');
            if (themeCard && this.tabContainer.contains(themeCard)) {
                event.stopPropagation();
                if (themeCard.dataset.theme) this.activateCard(themeCard.dataset.theme);
                return;
            }

            const randomBtn = target.closest('#random-theme-btn');
            if (randomBtn && this.tabContainer.contains(randomBtn)) {
                this.selectRandomTheme().catch((error) => {
                    console.error('[ThemesTab] Failed to select random theme:', error);
                });
                return;
            }

            if (target.closest('.theme-params-toggle')) this.toggleThemeParams();
            else if (target.closest('.themes-clear-filters')) this.clearFilters();
            else if (target.closest('.themes-search-clear')) this.clearSearch({ focus: true });
        };

        this.tabContainer.addEventListener('click', this.tabClickHandler, { signal: this.domAbortController?.signal });
        this.tabKeydownHandler = (event) => {
            const search = event.target?.closest?.('#themes-search-input');
            if (search) {
                if (event.key === 'Escape' && search.value) {
                    // The first Escape empties the search; the next one closes the Hub.
                    event.preventDefault();
                    event.stopPropagation();
                    this.clearSearch({ focus: true });
                } else if (event.key !== 'Escape' && event.key !== 'Tab') {
                    // Typing belongs to the field, not to a mode's one-key shortcuts
                    // (in Serenity Mode B, T, F and H would otherwise fire mid-word).
                    event.stopPropagation();
                }
                return;
            }
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const themeCard = event.target?.closest?.('.theme-card');
            if (!themeCard || !this.tabContainer.contains(themeCard)) return;

            event.preventDefault();
            event.stopPropagation();
            if (themeCard.dataset.theme) this.activateCard(themeCard.dataset.theme);
        };
        this.tabContainer.addEventListener('keydown', this.tabKeydownHandler, { signal: this.domAbortController?.signal });
        this.iconLoadHandler = (event) => {
            const icon = event.target;
            this.markThemeIconReady(icon);
        };
        this.iconErrorHandler = (event) => {
            const icon = event.target;
            if (!icon?.matches?.('.theme-icon-img[data-theme-icon-src]')) {
                return;
            }

            const preferredDesktopSrc = icon.dataset.themeDesktopIconSrc;
            const bundledSrc = icon.dataset.themeIconSrc;
            if (icon.dataset.iconLoadSource === 'desktop'
                && preferredDesktopSrc
                && bundledSrc
                && icon.dataset.iconFallbackTried !== 'true') {
                icon.dataset.iconFallbackTried = 'true';
                icon.dataset.iconLoadSource = 'bundled';
                icon.addEventListener('load', this.iconLoadHandler, { once: true, signal: this.domAbortController?.signal });
                icon.addEventListener('error', this.iconErrorHandler, { once: true, signal: this.domAbortController?.signal });
                icon.src = bundledSrc;
                this.syncThemeIconReadyState(icon);
                return;
            }

            const fallbackName = icon.dataset.themeIconFallback || 'palette';
            const fallback = document.createElement('div');
            fallback.className = 'theme-icon-emoji';
            fallback.innerHTML = csIcon(fallbackName, 40);
            icon.replaceWith(fallback);
            console.warn('[ThemesTab] Theme icon failed to load:', icon.dataset.themeIconSrc);
        };

        // Wire up search input
        const searchInput = this.tabContainer.querySelector('#themes-search-input');
        if (searchInput) {
            this.searchInputHandler = (event) => {
                this.searchQuery = event.target.value;
                if (this.searchClearButton) this.searchClearButton.hidden = !this.searchQuery;
                this.filterDirty = true;
                if (this.searchTimer !== null) clearTimeout(this.searchTimer);
                this.searchTimer = setTimeout(() => {
                    this.searchTimer = null;
                    if (this.active && !this.destroyed) this.refreshThemeGrid();
                }, 90);
            };
            searchInput.addEventListener('input', this.searchInputHandler, { signal: this.domAbortController?.signal });
        }

        this.attachThemeParamListeners();
    }

    /**
     * A card was chosen (click, Enter, Space, A on a pad). The first press shows the world in the
     * featured spot; pressing the chosen card again uses it, so a double click applies a theme
     * and one press never loads a renderer.
     */
    activateCard(themeId) {
        const view = this.collectionView;
        const failed = (error) => console.error('[ThemesTab] Failed to select theme:', error);
        if (!view) {
            this.selectTheme(themeId).catch(failed);
            return;
        }
        if (view.detailThemeId === themeId && view.canApply(themeId)) view.apply().catch(failed);
        else view.open(themeId);
    }

    markThemeIconReady(icon) {
        if (this.destroyed) return false;
        if (!icon?.matches?.('.theme-icon-img[data-theme-icon-src]')) {
            return false;
        }

        icon.classList.add('is-ready');
        this.iconReadyRecorder?.(icon);
        if (!this.hubIconsReadyRecorded) {
            this.hubIconsReadyRecorded = true;
            performanceMonitor.recordEvent('startup_hub_icons_ready', {
                tab: 'themes',
                themeId: icon.closest('.theme-card')?.dataset?.theme || null,
            });
        }

        return true;
    }

    syncThemeIconReadyState(icon) {
        if (!icon?.matches?.('.theme-icon-img[data-theme-icon-src]')) {
            return;
        }

        if (icon.complete && (Number(icon.naturalWidth) || 0) > 0) {
            this.markThemeIconReady(icon);
            return;
        }

        if (typeof icon.decode === 'function') {
            icon.decode()
                .then(() => {
                    if ((Number(icon.naturalWidth) || 0) > 0) {
                        this.markThemeIconReady(icon);
                    }
                })
                .catch(() => {});
        }
    }

    attachThemeParamListeners() {
        const panel = this.tabContainer?.querySelector('#theme-params') || document.getElementById('theme-params');
        if (!panel) return;
        const inputs = panel.querySelectorAll('[data-theme-param]');
        inputs.forEach((input) => {
            input.addEventListener('input', this.themeParamInputHandler);
        });
    }

    handleThemeParamInput(event) {
        const input = event.target;
        if (!input?.dataset?.themeParam) return;

        const key = input.dataset.themeParam;
        const value = input.type === 'color' ? input.value : parseFloat(input.value);
        const params = this.getTornadoParams();

        params[key] = value;
        this.settingsManager.update({ tornadoThemeParams: params });
        this.settingsManager.save();

        const valueEl = this.tabContainer?.querySelector(`[data-theme-param-value="${key}"]`)
            || document.querySelector(`[data-theme-param-value="${key}"]`);
        if (valueEl) {
            valueEl.textContent = this.formatParamValue(key, value);
        }
    }

    refreshThemeParams() {
        const panel = this.tabContainer?.querySelector('#theme-params') || document.getElementById('theme-params');
        if (!panel) return;
        const markup = this.renderThemeParams();
        this.holdGridPlace(() => {
            panel.innerHTML = markup;
            panel.hidden = !markup;
        });
        this.attachThemeParamListeners();
    }

    /**
     * Change what sits above the grid (the featured world's words, Tornado's controls) without
     * moving the list under the reader. While the action bar is stuck the featured world is out
     * of sight, so the scroll position takes up any change in its height. A browser with scroll
     * anchoring has already done that, and the shift measured here is then zero.
     */
    holdGridPlace(change) {
        const grid = this.tabContainer?.querySelector?.('#themes-grid');
        const bar = this.tabContainer?.querySelector?.('.themes-lib__bar');
        const scroller = this.hub?.getScrollContainer?.();
        const measurable = [grid, bar, scroller].every((node) => typeof node?.getBoundingClientRect === 'function');
        const stuck = measurable
            && bar.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + 1
            && scroller.scrollTop > 0;
        const before = stuck ? grid.getBoundingClientRect().top : 0;
        change();
        if (!stuck) return;
        const shift = grid.getBoundingClientRect().top - before;
        if (Math.abs(shift) >= 1) scroller.scrollTop += shift;
    }

    refreshThemeGrid() {
        if (this.destroyed) return;
        if (!this.active) {
            this.filterDirty = true;
            return;
        }
        this.filterDirty = false;
        const cards = Array.from(this.themeCardElements.values());
        if (cards.length === 0) {
            return;
        }

        const visibleThemeIds = this.getVisibleThemeIds();
        const visibleCount = applyThemeCardFilter(cards, visibleThemeIds);
        this.showEmptyState(visibleCount === 0);
        this.hydrateVisibleThemeCardIcons();
    }

    hydrateVisibleThemeCardIcons() {
        this.cancelIconHydration();
        if (!this.active || this.destroyed) return;

        const cards = Array.from(this.themeCardElements.values()).filter((card) => !card.hidden);
        if (cards.length === 0) {
            return;
        }

        const icons = cards
            .flatMap((card) => Array.from(card.querySelectorAll('.theme-icon-img[data-theme-icon-src]')))
            .filter((icon) => !icon.dataset.iconLoaded);

        if (icons.length === 0) {
            return;
        }

        const scrollContainer = this.hub.getScrollContainer?.() || null;
        const hydrationPlan = getThemeIconHydrationPlan(cards, { scrollContainer });
        const orderedIcons = [
            ...hydrationPlan.immediateIcons,
            ...hydrationPlan.deferredIcons,
        ].filter((icon, index, array) => array.indexOf(icon) === index && !icon.dataset.iconLoaded);
        if (orderedIcons.length === 0) {
            return;
        }

        const loadIcon = (icon, { highPriority = false } = {}) => {
            if (!icon || icon.dataset.iconLoaded === 'true') {
                return;
            }

            const { src, source } = resolveThemeIconHydrationSource(icon);
            if (!src) {
                return;
            }

            icon.dataset.iconLoaded = 'true';
            icon.dataset.iconLoadSource = source;
            icon.loading = highPriority ? 'eager' : 'lazy';
            icon.decoding = highPriority ? 'sync' : 'async';
            icon.setAttribute('fetchpriority', highPriority ? 'high' : 'low');
            icon.addEventListener('load', this.iconLoadHandler, { once: true, signal: this.domAbortController?.signal });
            icon.addEventListener('error', this.iconErrorHandler, { once: true, signal: this.domAbortController?.signal });
            icon.src = src;
            this.syncThemeIconReadyState(icon);
        };

        // Track icon loading performance
        const totalIcons = orderedIcons.length;
        let loadedCount = 0;
        const countedIcons = new WeakSet();
        const markStart = `theme-icons-hydrate-start-${totalIcons}`;
        if (typeof performance?.mark === 'function') {
            performance.mark(markStart);
        }
        this.iconReadyRecorder = (icon) => {
            if (!icon || countedIcons.has(icon)) {
                return;
            }

            countedIcons.add(icon);
            loadedCount += 1;
            if (loadedCount === totalIcons && typeof performance?.measure === 'function') {
                performance.measure(`theme-icons-all-loaded (${totalIcons})`, markStart);
            }
        };

        // In Electron packaged builds, icons are local files — load them all eagerly
        // in small rAF batches. No network bandwidth concern, and IntersectionObserver
        // can miss icons during the hub open animation or when scroll was misdirected.
        // Also fallback for environments without IntersectionObserver.
        const isElectronPackaged = Boolean(
            globalThis.window?.desktopRuntimeConfig?.isElectron
            && globalThis.window?.desktopRuntimeConfig?.isPackaged,
        );
        if (isElectronPackaged || typeof IntersectionObserver !== 'function') {
            // Load immediate icons first (high priority), then batch the rest
            hydrationPlan.immediateIcons.forEach((icon) => {
                loadIcon(icon, { highPriority: true });
            });
            const deferred = hydrationPlan.deferredIcons.filter((icon) => !icon.dataset.iconLoaded);
            if (deferred.length > 0) {
                const BATCH_SIZE = 8;
                let idx = 0;
                const loadBatch = () => {
                    this.iconBatchFrame = null;
                    if (!this.active || this.destroyed) return;
                    const end = Math.min(idx + BATCH_SIZE, deferred.length);
                    for (let i = idx; i < end; i++) {
                        loadIcon(deferred[i]);
                    }
                    idx = end;
                    if (idx < deferred.length) {
                        this.iconBatchFrame = requestAnimationFrame(loadBatch);
                    }
                };
                this.iconBatchFrame = requestAnimationFrame(loadBatch);
            }
            return;
        }

        this.iconObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (!entry.isIntersecting) {
                    return;
                }

                loadIcon(entry.target);
                observer.unobserve(entry.target);
            });
        }, createThemeIconObserverOptions(scrollContainer));

        hydrationPlan.immediateIcons.forEach((icon) => {
            loadIcon(icon, { highPriority: true });
        });
        hydrationPlan.deferredIcons.forEach((icon) => {
            this.iconObserver.observe(icon);
        });
    }

    /**
     * Select a category filter
     * @param {string} category - Category ID
     */
    selectCategory(category) {
        if (this.selectedCategory === category) return;

        this.selectedCategory = category;

        // Update filter chips
        const pills = this.tabContainer?.querySelectorAll('.category-pill') || [];
        pills.forEach((pill) => {
            const pressed = pill.dataset.category === category;
            pill.classList.toggle('active', pressed);
            pill.setAttribute?.('aria-pressed', String(pressed));
        });

        // Update themes grid
        this.refreshThemeGrid();
    }

    /**
     * Select and apply a theme
     * @param {string} themeId - Theme ID to apply
     */
    async selectTheme(themeId) {
        if (this.collectionView && !this.collectionView.collection.isUnlocked(themeId)) {
            this.collectionView.open(themeId);
            return;
        }
        if (this.themeManager.canSelectTheme?.(themeId) === false) return;
        const selectionGeneration = (this.themeSelectionGeneration ?? 0) + 1;
        this.themeSelectionGeneration = selectionGeneration;

        // Guard against the MANAGER's truth, not this tab's shadow copy: after any
        // failed/superseded switch the shadow used to claim a theme that never
        // started, making a re-click of the wanted theme a silent no-op.
        if (themeId === this.themeManager.activeThemeName
            && this.themeManager.activeTheme
            && !this.themeManager.isTransitioning) {
            this.currentTheme = themeId;
            return;
        }

        console.log('[ThemesTab] Switching to theme:', themeId);

        // Update theme via theme manager. Resolves after the switch (and any
        // coalesced follow-up it was queued behind) settles — possibly on a
        // DIFFERENT theme than requested (drop, supersede, or forest fallback).
        await this.themeManager.switchTheme(themeId);

        // A newer card activation owns the UI/settings commit. The manager
        // coalesces rapid requests, so an older caller must not persist an
        // intermediate theme and enqueue it again through settingsChanged.
        if (this.destroyed || selectionGeneration !== this.themeSelectionGeneration) {
            return;
        }

        // Commit only what actually happened. Persisting the *requested* id after
        // a failed switch stored a theme that never started — the hub badge lied
        // and the broken choice came back on next boot.
        const appliedTheme = this.themeManager.activeThemeName;
        this.currentTheme = appliedTheme;

        const canPersist = !this.collectionView || (appliedTheme === themeId
            && this.collectionView.collection.isUnlocked(appliedTheme));
        if (appliedTheme && canPersist) {
            this.settingsManager.update({
                backgroundTheme: appliedTheme,
                backgroundMode: 'Specific',
            });
            this.settingsManager.save();
            console.log('[ThemesTab] Theme saved to settings:', appliedTheme, 'mode set to Specific');
        }
        if (appliedTheme !== themeId) {
            console.warn(
                `[ThemesTab] Requested "${themeId}" but active theme is "${appliedTheme}" (failed or superseded switch)`,
            );
        }

        // A hidden tab retains data and catches up when activated.
        if (this.active !== false) {
            this.updateThemeSelection();
            this.refreshThemeParams();
            this.collectionView?.refresh();
        }
    }

    /**
     * Select a random theme
     */
    async selectRandomTheme() {
        if (this.themeManager.isOdysseyThemeScopeActive?.()) return;
        // Filter out current theme
        const availableThemes = this.themes.filter((t) => t.id !== this.currentTheme
            && (!this.collectionView || this.collectionView.collection.isUnlocked(t.id)));

        if (availableThemes.length === 0) return;

        // Pick random theme
        const randomTheme = availableThemes[Math.floor(Math.random() * availableThemes.length)];

        // Apply theme. The featured world follows it, wherever the grid is scrolled to.
        await this.selectTheme(randomTheme.id);
        if (this.destroyed || this.active === false) return;
        this.collectionView?.showCurrent();
    }

    /**
     * Bring the cards in line with what is on and what is featured. Only the cards whose state
     * changed are touched: the theme that was on, the one that is, and the same for the
     * featured spot.
     */
    updateThemeSelection() {
        if (this.destroyed || this.active === false) return;
        const shown = this.collectionView?.shownThemeId() ?? this.currentTheme;
        const owned = !this.collectionView || this.collectionView.collection.isUnlocked(this.currentTheme);
        // The chosen card says that pressing it again uses it, while that is true.
        const usable = Boolean(this.collectionView?.canApply(shown));
        const key = `${this.currentTheme}|${shown}|${owned}|${usable}`;
        if (key === this.renderedSelectionKey) return;
        this.renderedSelectionKey = key;
        const ids = new Set([this.renderedTheme, this.currentTheme, this.renderedShownTheme, shown]);
        ids.forEach((id) => {
            const card = this.themeCardElements?.get(id);
            if (!card) return;
            const isActive = owned && id === this.currentTheme;
            card.classList.toggle('active', isActive);
            card.classList.toggle('is-usable', usable && id === shown);
            card.setAttribute('aria-pressed', String(id === shown));
            card.setAttribute('aria-current', String(isActive));
            const swatch = card.querySelector('.theme-swatch');
            if (!swatch) return;
            const indicator = swatch.querySelector('.active-indicator');
            if (isActive && !indicator) {
                const nextIndicator = document.createElement('span');
                nextIndicator.className = 'active-indicator';
                nextIndicator.textContent = CURRENT_LABEL;
                swatch.appendChild(nextIndicator);
            } else if (!isActive && indicator) indicator.remove();
        });
        this.renderedTheme = this.currentTheme;
        this.renderedShownTheme = shown;
    }

    /**
     * Listen for theme changes from external sources (like keyboard shortcut)
     */
    listenForThemeChanges() {
        this.themeChangeHandler = (payload) => {
            const { themeName } = payload;
            if (themeName && themeName !== this.currentTheme) {
                console.log('[ThemesTab] External theme change detected:', themeName);
                this.currentTheme = themeName;
                if (this.active) this.syncSelectionUI();
            }
        };

        // Use event bus to listen for theme changes
        this.unsubscribeThemeChange = eventBus.on(EVENTS.THEME_CHANGED, this.themeChangeHandler);
        console.log('[ThemesTab] Listening for theme changes via event bus');
    }

    /**
     * Refresh current theme from theme manager
     * Called when tab becomes visible to sync with any external theme changes
     */
    refreshCurrentTheme() {
        const activeTheme = this.themeManager.activeThemeName;
        if (activeTheme) this.currentTheme = activeTheme;
        if (this.active && this.currentTheme !== this.renderedTheme) this.syncSelectionUI();
    }

    syncSelectionUI() {
        if (!this.active || this.destroyed) return;
        this.updateThemeSelection();
        this.refreshThemeParams();
        this.collectionView?.refresh();
    }

    cancelIconHydration() {
        if (this.iconBatchFrame !== null) cancelAnimationFrame(this.iconBatchFrame);
        this.iconBatchFrame = null;
        this.iconObserver?.disconnect();
        this.iconObserver = null;
    }

    setActive(active) {
        const nextActive = Boolean(active) && !this.destroyed;
        if (nextActive === this.active) return;
        this.active = nextActive;
        if (this.active) {
            this.refreshCurrentTheme();
            this.collectionView?.activate();
            if (this.filterDirty) this.refreshThemeGrid();
            else this.hydrateVisibleThemeCardIcons();
        } else {
            this.cancelIconHydration();
            if (this.searchTimer !== null) clearTimeout(this.searchTimer);
            this.searchTimer = null;
            // Next time the tab opens on the world that is on, not on one that was being looked at.
            this.collectionView?.showCurrent();
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.setActive(false);
        this.destroyed = true;
        this.collectionView?.destroy();
        this.domAbortController?.abort();
        if (this.tabContainer && this.tabClickHandler) {
            this.tabContainer.removeEventListener('click', this.tabClickHandler);
            this.tabClickHandler = null;
        }
        if (this.tabContainer && this.tabKeydownHandler) {
            this.tabContainer.removeEventListener('keydown', this.tabKeydownHandler);
            this.tabKeydownHandler = null;
        }

        // Clean up search input listener
        const searchInput = this.tabContainer?.querySelector('#themes-search-input');
        if (searchInput && this.searchInputHandler) {
            searchInput.removeEventListener('input', this.searchInputHandler);
            this.searchInputHandler = null;
        }
        this.iconLoadHandler = null;
        this.iconErrorHandler = null;
        this.iconReadyRecorder = null;
        if (this.iconObserver) {
            this.iconObserver.disconnect();
            this.iconObserver = null;
        }
        this.debouncedSearchHandler = null;
        this.themeCardElements.clear();
        this.emptyStateElement = null;
        this.searchClearButton = null;

        this.tabContainer = null;

        // Unsubscribe from theme change events
        if (this.unsubscribeThemeChange) {
            this.unsubscribeThemeChange();
            this.unsubscribeThemeChange = null;
        }
        console.log('[ThemesTab] Destroyed');
    }
}
