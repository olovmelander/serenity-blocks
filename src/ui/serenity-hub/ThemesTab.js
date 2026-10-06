/**
 * @fileoverview Themes Tab Component for Serenity Hub
 * Provides theme browser with visual swatches and category filtering
 */

import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { TORNADO_PARAM_DEFAULTS, TORNADO_PARAM_RANGES } from '../../themes/tornado/params.ts';
import { performanceMonitor } from '../../utils/performance-monitor.js';
import { scrollHubElementIntoView } from './hub-scroll-utils.js';
import {
    resolveDesktopHubThemeThumbnailUrl,
    resolveHubThemeThumbnailUrl,
} from './theme-thumbnail-manifest.js';
import { initThemeCardInteractions } from './theme-card-interactions.js';
import { csIcon } from '../components/cosmic-icons.js';

const CURRENT_LABEL = 'Current';

/** Tornado's live parameters, in words (the keys stay the settings' own). */
const PARAM_LABELS = Object.freeze({
    emissiveColor: 'Glow colour',
    timeScale: 'Speed',
    ribbonWidth: 'Ribbon width',
    parabolaStrength: 'Curve strength',
    parabolaOffset: 'Curve offset',
    parabolaAmplitude: 'Curve height',
    bloomStrength: 'Bloom',
    bloomRadius: 'Bloom radius',
});

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

const CATEGORY_ICON_SVG_OPEN = [
    '<svg class="pill-icon-svg" viewBox="0 0 24 24" fill="none"',
    'stroke="currentColor" stroke-width="2" stroke-linecap="round"',
    'stroke-linejoin="round" aria-hidden="true">',
].join(' ');

function createCategoryIconSvg(paths) {
    return [CATEGORY_ICON_SVG_OPEN, ...paths, '</svg>'].join('');
}

export const CATEGORY_ICON_SVGS = Object.freeze({
    all: createCategoryIconSvg([
        '<circle cx="12" cy="12" r="7.25"></circle>',
        '<circle cx="12" cy="12" r="2.4"></circle>',
        '<path d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5"></path>',
        '<circle cx="12" cy="4.25" r="0.9"></circle>',
        '<circle cx="19.75" cy="12" r="0.9"></circle>',
        '<circle cx="12" cy="19.75" r="0.9"></circle>',
        '<circle cx="4.25" cy="12" r="0.9"></circle>',
    ]),
    abstract: createCategoryIconSvg([
        '<path d="M4 15c3.4-7.4 7.4 7.4 11 0 1.6-3.3 3.4-4.1 5-2"></path>',
        '<path d="M5 9.5c3.8 4.2 7.2-4.2 10.7 0 1.3 1.6 2.5 1.8 3.8 0.7"></path>',
        '<path d="M8 18c2.2-1.1 5.7-1.1 8 0"></path>',
    ]),
    atmospheric: createCategoryIconSvg([
        '<path d="M5 12c2.2-4.3 8.9-5.7 12.2-2.1 2 2.2 0.8 5.6-2.4 6.5"></path>',
        '<path d="M14.8 16.4c-3.2 0.9-6.1-1.1-5.7-3.5 0.3-1.9 2.7-2.7 4.5-1.7"></path>',
        '<path d="M4 7.5h5.2M3.5 17.5h6M15.5 5.5h4.5M16.8 19h3.2"></path>',
    ]),
    biomes: createCategoryIconSvg([
        '<path d="M3.5 17.5 8.8 8.8l3 4.1 2.4-3.5 6.3 8.1"></path>',
        '<path d="M6 17.2c1.6-3.3 4.5-3.8 6-2.5-1.2 2.4-3.6 3.3-6 2.5z"></path>',
        '<path d="M8.2 16.1 11 14.7"></path>',
    ]),
    cosmic: createCategoryIconSvg([
        '<circle cx="12" cy="12" r="2.3"></circle>',
        '<ellipse cx="12" cy="12" rx="8.1" ry="3.2" transform="rotate(-24 12 12)"></ellipse>',
        '<path d="M18.2 4.4v3.2M16.6 6h3.2M5.5 18.5l1.2 1.2M6.7 17.3l-1.2 1.2"></path>',
    ]),
    fantasy: createCategoryIconSvg([
        '<path d="M12 3.5 17 9l-5 11.5L7 9l5-5.5z"></path>',
        '<path d="M7 9h10M10.2 6.1 12 20.5M13.8 6.1 12 20.5"></path>',
        '<path d="M3.8 9.8h2M18.2 9.8h2M5.2 15.4l1.4-1.4M17.4 14l1.4 1.4"></path>',
    ]),
    meditation: createCategoryIconSvg([
        '<circle cx="12" cy="12" r="2.2"></circle>',
        '<path d="M7 12c0-3.1 2-5.1 5-5.1s5 2 5 5.1"></path>',
        '<path d="M5 15c1.8 2.2 4.1 3.2 7 3.2s5.2-1 7-3.2"></path>',
        '<path d="M8.2 14.2c2.4 1.8 5.2 1.8 7.6 0"></path>',
    ]),
    sky: createCategoryIconSvg([
        '<path d="M4 16.5c2.5-3.1 5.2-4.6 8-4.6s5.5 1.5 8 4.6"></path>',
        '<path d="M7 10.5c1.8-2.7 3.7-3.8 6-3.5M11 10c2.3-3.4 4.5-4.4 7-3.1"></path>',
        '<path d="M5 19h14"></path>',
    ]),
    urban: createCategoryIconSvg([
        '<path d="M4 18V10h4v8M8 18V6h5v12M13 18v-7h3v7M16 18V8h4v10"></path>',
        '<path d="M3 18h18M6 13h0.01M10.5 9h0.01M18 11h0.01M14.5 14h0.01"></path>',
    ]),
});

export function getCategoryIconSvg(categoryId) {
    return CATEGORY_ICON_SVGS[categoryId] || CATEGORY_ICON_SVGS.all;
}

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
            {
                id: 'all', name: 'All', iconSvg: getCategoryIconSvg('all'), count: this.themes.length,
            },
        ];

        const label = (cat) => CATEGORY_LABELS[cat] || cat;
        Array.from(categorySet).sort((a, b) => label(a).localeCompare(label(b))).forEach((cat) => {
            const count = this.themes.filter((t) => t.group === cat).length;
            categories.push({
                id: cat,
                name: label(cat),
                iconSvg: getCategoryIconSvg(cat),
                count,
            });
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
            'Electric Dreams': 'bolt',
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

        // Toolbar (sticky while the grid scrolls): search, what is on now, a random pick, the
        // category chips. Then the worlds, then Tornado's live controls.
        container.innerHTML = `
            <div class="themes-tab">
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
                        <p class="current-theme-badge">
                            <span class="badge-label">Current</span>
                            <span class="badge-text">${escapeHtml(this.getCurrentThemeDisplayName())}</span>
                        </p>
                        <button type="button" class="sb-btn random-theme-btn" id="random-theme-btn">
                            ${csIcon('dice', 18)}<span class="btn-text">Try a random theme</span>
                        </button>
                    </div>
                    <div class="category-filter" role="group" aria-label="Categories">
                        ${this.renderCategoryFilters()}
                    </div>
                </div>

                <div class="themes-grid" id="themes-grid"></div>

                <div class="theme-params" id="theme-params">
                    ${this.renderThemeParams()}
                </div>
            </div>
        `;

        this.badgeElement = container.querySelector('.badge-text');
        this.searchClearButton = container.querySelector('.themes-search-clear');
        this.populateThemeGrid();

        // Phase 5: cursor-follow spotlight + parallax tilt on theme cards
        // (delegated to the grid, so it survives populateThemeGrid re-renders).
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
                <span class="pill-icon" aria-hidden="true">${cat.iconSvg}</span>
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
        const visibleThemeIds = getFilteredThemeIds(this.themes, this.selectedCategory, this.searchQuery);
        return this.themes
            .filter((theme) => visibleThemeIds.includes(theme.id))
            .sort((left, right) => left.displayName.localeCompare(right.displayName));
    }

    /**
     * Render theme cards
     * @returns {string} HTML for theme cards
     */
    renderThemeCards() {
        const sortedThemes = [...this.themes].sort((left, right) => left.displayName.localeCompare(right.displayName));

        // The category's hue comes from data-group in keystone-hub.css (no inline styles).
        return sortedThemes.map((theme) => {
            const isActive = theme.id === this.currentTheme;
            const iconHtml = this.getThemeIcon(theme);

            return `
                <div class="theme-card${isActive ? ' active' : ''}"
                     data-theme="${theme.id}"
                     data-group="${theme.group || ''}"
                     tabindex="0"
                     role="button"
                     aria-label="Select ${escapeHtml(theme.displayName)} theme"
                     aria-pressed="${isActive}">
                    <div class="theme-swatch">
                        ${iconHtml}
                        ${isActive ? `<span class="active-indicator">${CURRENT_LABEL}</span>` : ''}
                    </div>
                    <div class="theme-info">
                        <div class="theme-name">${escapeHtml(theme.displayName)}</div>
                        <div class="theme-category">${escapeHtml(this.getCategoryDisplayName(theme.group))}</div>
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
        const visibleThemeIds = getFilteredThemeIds(this.themes, this.selectedCategory, this.searchQuery);
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
        this.clearSearch({ focus: true, refresh: this.selectedCategory === 'all' });
        if (this.selectedCategory !== 'all') this.selectCategory('all');
    }

    /**
     * Render theme parameter controls (Tornado only for now)
     * @returns {string} HTML for theme controls
     */
    renderThemeParams() {
        if (this.currentTheme !== 'tornado') {
            return `
                <p class="theme-params-empty">
                    Tornado has live controls. Choose it to adjust them here.
                </p>
            `;
        }

        const params = this.getTornadoParams();

        return `
            <div class="theme-params-panel">
                <p class="sb-eyebrow theme-params-title">Tornado · Live controls</p>
                ${this.renderThemeParamColor('emissiveColor', params.emissiveColor)}
                ${this.renderThemeParamRange('timeScale', params.timeScale)}
                ${this.renderThemeParamRange('ribbonWidth', params.ribbonWidth)}
                ${this.renderThemeParamRange('parabolaStrength', params.parabolaStrength)}
                ${this.renderThemeParamRange('parabolaOffset', params.parabolaOffset)}
                ${this.renderThemeParamRange('parabolaAmplitude', params.parabolaAmplitude)}
                ${this.renderThemeParamRange('bloomStrength', params.bloomStrength)}
                ${this.renderThemeParamRange('bloomRadius', params.bloomRadius)}
            </div>
        `;
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
        return category ? category.name : id;
    }

    /**
     * Get current theme display name
     * @returns {string} Current theme name
     */
    getCurrentThemeDisplayName() {
        const theme = this.themes.find((t) => t.id === this.currentTheme);
        return theme ? theme.displayName : this.currentTheme;
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
                const themeId = themeCard.dataset.theme;
                if (themeId) {
                    this.selectTheme(themeId).catch((error) => {
                        console.error('[ThemesTab] Failed to select theme:', error);
                    });
                }
                return;
            }

            const randomBtn = target.closest('#random-theme-btn');
            if (randomBtn && this.tabContainer.contains(randomBtn)) {
                this.selectRandomTheme().catch((error) => {
                    console.error('[ThemesTab] Failed to select random theme:', error);
                });
                return;
            }

            if (target.closest('.themes-clear-filters')) this.clearFilters();
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
            const themeId = themeCard.dataset.theme;
            if (themeId) {
                this.selectTheme(themeId).catch((error) => {
                    console.error('[ThemesTab] Failed to select theme:', error);
                });
            }
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
        panel.innerHTML = this.renderThemeParams();
        this.attachThemeParamListeners();
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

        const visibleThemeIds = getFilteredThemeIds(this.themes, this.selectedCategory, this.searchQuery);
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

        if (appliedTheme) {
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
            this.updateCurrentThemeBadge();
            this.refreshThemeParams();
        }
    }

    /**
     * Select a random theme
     */
    async selectRandomTheme() {
        // Filter out current theme
        const availableThemes = this.themes.filter((t) => t.id !== this.currentTheme);

        if (availableThemes.length === 0) return;

        // Pick random theme
        const randomTheme = availableThemes[Math.floor(Math.random() * availableThemes.length)];

        // Apply theme
        await this.selectTheme(randomTheme.id);
        if (this.destroyed || this.active === false) return;

        // Scroll to the theme card
        const card = this.tabContainer?.querySelector(`.theme-card[data-theme="${randomTheme.id}"]`)
            || document.querySelector(`.theme-card[data-theme="${randomTheme.id}"]`);
        if (card) {
            scrollHubElementIntoView(card, { block: 'center' });
        }
    }

    /**
     * Update theme selection in UI
     */
    updateThemeSelection() {
        if (this.destroyed || this.active === false) return;
        const cards = new Set([
            this.themeCardElements?.get(this.renderedTheme),
            this.themeCardElements?.get(this.currentTheme),
        ]);
        cards.forEach((card) => {
            if (!card) return;
            const isActive = card.dataset.theme === this.currentTheme;
            card.classList.toggle('active', isActive);
            card.setAttribute('aria-pressed', String(isActive));
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
    }

    /** The toolbar's "Current" line: the label is static, this is the world's name. */
    updateCurrentThemeBadge() {
        const badge = this.badgeElement;
        const text = this.getCurrentThemeDisplayName();
        if (badge && badge.textContent !== text) badge.textContent = text;
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
        this.updateCurrentThemeBadge();
        this.refreshThemeParams();
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
            if (this.filterDirty) this.refreshThemeGrid();
            else this.hydrateVisibleThemeCardIcons();
        } else {
            this.cancelIconHydration();
            if (this.searchTimer !== null) clearTimeout(this.searchTimer);
            this.searchTimer = null;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        this.setActive(false);
        this.destroyed = true;
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
