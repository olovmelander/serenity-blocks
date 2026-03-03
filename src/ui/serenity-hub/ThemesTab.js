/**
 * @fileoverview Themes Tab Component for Serenity Hub
 * Provides theme browser with visual swatches and category filtering
 */

import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { TORNADO_PARAM_DEFAULTS, TORNADO_PARAM_RANGES } from '../../themes/tornado/params.ts';

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
        this.searchInputHandler = null;

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
                id: 'all', name: 'All Themes', icon: '🌍', count: this.themes.length,
            },
        ];

        const categoryInfo = {
            biomes: { name: 'Nature', icon: '🌲' },
            cosmic: { name: 'Cosmic', icon: '✨' },
            meditation: { name: 'Meditation', icon: '🧘' },
            urban: { name: 'Urban', icon: '🏙️' },
            fantasy: { name: 'Fantasy', icon: '🔮' },
            abstract: { name: 'Abstract', icon: '🎨' },
            sky: { name: 'Sky', icon: '☁️' },
            atmospheric: { name: 'Atmospheric', icon: '🌪️' },
        };

        Array.from(categorySet).sort().forEach((cat) => {
            const info = categoryInfo[cat] || { name: cat, icon: '🎭' };
            const count = this.themes.filter((t) => t.group === cat).length;
            categories.push({
                id: cat,
                name: info.name,
                icon: info.icon,
                count,
            });
        });

        return categories;
    }

    /**
     * Get color scheme for a theme based on its group
     * @param {string} group - Theme group
     * @returns {Object} Color scheme
     */
    getThemeColorScheme(group) {
        const schemes = {
            biomes: { primary: '#4CAF50', secondary: '#81C784', gradient: 'linear-gradient(135deg, #4CAF50, #81C784)' },
            cosmic: { primary: '#9C27B0', secondary: '#CE93D8', gradient: 'linear-gradient(135deg, #9C27B0, #CE93D8)' },
            meditation: { primary: '#FF9800', secondary: '#FFB74D', gradient: 'linear-gradient(135deg, #FF9800, #FFB74D)' },
            urban: { primary: '#607D8B', secondary: '#90A4AE', gradient: 'linear-gradient(135deg, #607D8B, #90A4AE)' },
            fantasy: { primary: '#E91E63', secondary: '#F48FB1', gradient: 'linear-gradient(135deg, #E91E63, #F48FB1)' },
            abstract: { primary: '#00BCD4', secondary: '#80DEEA', gradient: 'linear-gradient(135deg, #00BCD4, #80DEEA)' },
            sky: { primary: '#2196F3', secondary: '#64B5F6', gradient: 'linear-gradient(135deg, #2196F3, #64B5F6)' },
        };
        return schemes[group] || schemes.biomes;
    }

    /**
     * Get icon for theme (PNG or emoji fallback)
     * @param {Object} theme - Theme object with id and displayName
     * @returns {string} HTML string for icon (img tag or emoji div)
     */
    getThemeIcon(theme) {
        // Check if theme has custom PNG icon
        const themeMeta = THEME_REGISTRY.find((t) => t.id === theme.id);
        if (themeMeta?.icon) {
            // Extract just the filename from the icon path
            // themeMeta.icon is like './ice-temple/ice-temple-theme-icon.png'
            const iconFilename = themeMeta.icon.split('/').pop();
            // Reference from public/assets/themes folder
            const iconPath = `assets/themes/${iconFilename}`;
            return `<img src="${iconPath}" alt="${theme.displayName}" class="theme-icon-img" />`;
        }

        // Fallback to emoji icons
        const icons = {
            Forest: '🌲',
            'Himalayan Peak': '🏔️',
            'Ice Temple': '❄️',
            'Moonlit Forest': '🌙',
            Wolfhour: '🐺',
            Ocean: '🌊',
            Sunset: '🌅',
            Mountain: '⛰️',
            'Zen Garden': '🎋',
            Winter: '☃️',
            Fall: '🍂',
            Summer: '☀️',
            Tornado: '🌪️',
            Aurora: '🌌',
            Galaxy: '🌌',
            'Rainy Window': '🌧️',
            'Koi Pond': '🐟',
            Meadow: '🌼',
            'Cosmic Chimes': '🎐',
            'Singing Bowl': '🔔',
            Starlight: '⭐',
            'Sky Children': '☁️',
            'Sky Children v2': '🌤️',
            'Swedish Forest': '🌲',
            Geode: '💎',
            Bioluminescence: '🦑',
            'Desert Oasis': '🏜️',
            'Bamboo Grove': '🎋',
            'Misty Lake': '🌫️',
            Waves: '🌊',
            'Fluid Dreams': '💧',
            'Lantern Festival': '🏮',
            'Crystal Cave': '💎',
            'Candlelit Monastery': '🕯️',
            'Cherry Blossom Garden': '🌸',
            'Floating Islands': '🏝️',
            'Meditation Temple': '🛕',
            'Moonlit Greenhouse': '🌿',
            'Electric Dreams': '⚡',
            'Nebula Flow': '🌀',
            Lunara: '🌙',
            Pyrestorm: '🔥',
            'Neon Dusk': '🌆',
            Stillwater: '💧',
        };
        const emoji = icons[theme.displayName] || '🎨';
        return `<div class="theme-icon-emoji">${emoji}</div>`;
    }

    /**
     * Renders the themes tab content
     */
    render() {
        const container = document.getElementById('tab-themes');
        if (!container) {
            console.error('[ThemesTab] Container not found');
            return;
        }

        // Clear loading message
        container.innerHTML = `
            <div class="themes-tab">
                <!-- Compact control bar: search + badge -->
                <div class="themes-control-bar">
                    <div class="themes-search-wrap">
                        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="m21 21-4.35-4.35"></path>
                        </svg>
                        <input
                            type="text"
                            class="themes-search-input"
                            id="themes-search-input"
                            placeholder="Search themes..."
                            autocomplete="off"
                            spellcheck="false"
                        />
                    </div>
                    <div class="current-theme-badge">
                        <span class="badge-icon">✓</span>
                        <span class="badge-text">Current: ${this.getCurrentThemeDisplayName()}</span>
                    </div>
                </div>

                <!-- Category Filter Pills -->
                <div class="category-filter">
                    ${this.renderCategoryFilters()}
                </div>

                <!-- Themes Grid -->
                <div class="themes-grid" id="themes-grid">
                    ${this.renderThemeCards()}
                </div>

                <!-- Random Theme Button -->
                <div class="theme-actions">
                    <button class="random-theme-btn" id="random-theme-btn">
                        <span class="btn-icon">🎲</span>
                        <span class="btn-text">Random Theme</span>
                    </button>
                </div>

                <!-- Theme Parameters -->
                <div class="theme-params" id="theme-params">
                    ${this.renderThemeParams()}
                </div>
            </div>
        `;
    }

    /**
     * Render category filter pills
     * @returns {string} HTML for category filters
     */
    renderCategoryFilters() {
        return this.categories.map((cat) => `
            <button class="category-pill ${cat.id === this.selectedCategory ? 'active' : ''}"
                    data-category="${cat.id}">
                <span class="pill-icon">${cat.icon}</span>
                <span class="pill-text">${cat.name}</span>
                <span class="pill-count">${cat.count}</span>
            </button>
        `).join('');
    }

    /**
     * Get filtered and sorted themes based on current category + search query
     * @returns {Array} Filtered theme array
     */
    filterThemes() {
        let filtered = this.selectedCategory === 'all'
            ? this.themes
            : this.themes.filter((t) => t.group === this.selectedCategory);

        if (this.searchQuery.trim()) {
            const q = this.searchQuery.toLowerCase();
            filtered = filtered.filter((t) =>
                t.displayName.toLowerCase().includes(q)
                || (t.group && t.group.toLowerCase().includes(q))
            );
        }

        return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    /**
     * Render theme cards
     * @returns {string} HTML for theme cards
     */
    renderThemeCards() {
        const sortedThemes = this.filterThemes();

        if (sortedThemes.length === 0) {
            return '<div class="no-themes">No themes found</div>';
        }

        return sortedThemes.map((theme) => {
            const isActive = theme.id === this.currentTheme;
            const colorScheme = this.getThemeColorScheme(theme.group);
            const iconHtml = this.getThemeIcon(theme);

            return `
                <div class="theme-card ${isActive ? 'active' : ''}"
                     data-theme="${theme.id}"
                     tabindex="0"
                     style="--theme-gradient: ${colorScheme.gradient}">
                    <div class="theme-swatch" style="background: ${colorScheme.gradient}">
                        ${iconHtml}
                        ${isActive ? '<div class="active-indicator">✓</div>' : ''}
                    </div>
                    <div class="theme-info">
                        <div class="theme-name">${theme.displayName}</div>
                        <div class="theme-category">${this.getCategoryDisplayName(theme.group)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Render theme parameter controls (Tornado only for now)
     * @returns {string} HTML for theme controls
     */
    renderThemeParams() {
        if (this.currentTheme !== 'tornado') {
            return `
                <div class="theme-params-empty">
                    Select Tornado to adjust live parameters.
                </div>
            `;
        }

        const params = this.getTornadoParams();

        return `
            <div class="theme-params-panel">
                <div class="theme-params-title">Tornado Controls</div>
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
                <label class="theme-param-label" for="theme-param-${key}">${key}</label>
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
                <label class="theme-param-label" for="theme-param-${key}">${key}</label>
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
        this.tabContainer = document.getElementById('tab-themes');
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
            }
        };

        this.tabContainer.addEventListener('click', this.tabClickHandler);

        // Wire up search input
        const searchInput = this.tabContainer.querySelector('#themes-search-input');
        if (searchInput) {
            this.searchInputHandler = (e) => {
                this.searchQuery = e.target.value;
                const grid = this.tabContainer.querySelector('#themes-grid');
                if (grid) {
                    grid.innerHTML = this.renderThemeCards();
                }
            };
            searchInput.addEventListener('input', this.searchInputHandler);
        }

        this.attachThemeParamListeners();
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

    /**
     * Select a category filter
     * @param {string} category - Category ID
     */
    selectCategory(category) {
        if (this.selectedCategory === category) return;

        this.selectedCategory = category;

        // Update filter pills
        const pills = this.tabContainer?.querySelectorAll('.category-pill') || [];
        pills.forEach((pill) => {
            pill.classList.toggle('active', pill.dataset.category === category);
        });

        // Update themes grid
        const grid = this.tabContainer?.querySelector('#themes-grid') || document.getElementById('themes-grid');
        if (grid) {
            grid.innerHTML = this.renderThemeCards();
        }
    }

    /**
     * Select and apply a theme
     * @param {string} themeId - Theme ID to apply
     */
    async selectTheme(themeId) {
        if (themeId === this.currentTheme) return;

        console.log('[ThemesTab] Switching to theme:', themeId);

        // Update theme via theme manager
        await this.themeManager.switchTheme(themeId);

        // Update current theme
        this.currentTheme = themeId;

        // Update settings and save to disk
        this.settingsManager.update({ backgroundTheme: themeId });
        this.settingsManager.save();
        console.log('[ThemesTab] Theme saved to settings:', themeId);

        // Update UI
        this.updateThemeSelection();
        this.updateCurrentThemeBadge();
        this.refreshThemeParams();
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

        // Scroll to the theme card
        const card = this.tabContainer?.querySelector(`.theme-card[data-theme="${randomTheme.id}"]`)
            || document.querySelector(`.theme-card[data-theme="${randomTheme.id}"]`);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /**
     * Update theme selection in UI
     */
    updateThemeSelection() {
        // Search within the themes tab container specifically
        const tabContainer = document.getElementById('tab-themes');
        if (!tabContainer) {
            console.warn('[ThemesTab] Tab container not found!');
            return;
        }

        const cards = tabContainer.querySelectorAll('.theme-card');

        cards.forEach((card) => {
            const themeId = card.dataset.theme;
            const isActive = themeId === this.currentTheme;

            card.classList.toggle('active', isActive);

            // Update active indicator
            const swatch = card.querySelector('.theme-swatch');
            if (!swatch) return;

            const existingIndicator = swatch.querySelector('.active-indicator');

            if (isActive && !existingIndicator) {
                const indicator = document.createElement('div');
                indicator.className = 'active-indicator';
                indicator.textContent = '✓';
                swatch.appendChild(indicator);
            } else if (!isActive && existingIndicator) {
                existingIndicator.remove();
            }
        });
    }

    /**
     * Update current theme badge
     */
    updateCurrentThemeBadge() {
        const tabContainer = document.getElementById('tab-themes');
        if (!tabContainer) return;

        const badge = tabContainer.querySelector('.badge-text');
        if (badge) {
            badge.textContent = `Current: ${this.getCurrentThemeDisplayName()}`;
        }
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
                this.updateThemeSelection();
                this.updateCurrentThemeBadge();
                this.refreshThemeParams();
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
        if (activeTheme && activeTheme !== this.currentTheme) {
            console.log('[ThemesTab] Refreshing theme:', activeTheme);
            this.currentTheme = activeTheme;
            this.updateThemeSelection();
            this.updateCurrentThemeBadge();
            this.refreshThemeParams();
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.tabContainer && this.tabClickHandler) {
            this.tabContainer.removeEventListener('click', this.tabClickHandler);
            this.tabClickHandler = null;
        }

        // Clean up search input listener
        const searchInput = this.tabContainer?.querySelector('#themes-search-input');
        if (searchInput && this.searchInputHandler) {
            searchInput.removeEventListener('input', this.searchInputHandler);
            this.searchInputHandler = null;
        }

        this.tabContainer = null;

        // Unsubscribe from theme change events
        if (this.unsubscribeThemeChange) {
            this.unsubscribeThemeChange();
            this.unsubscribeThemeChange = null;
        }
        console.log('[ThemesTab] Destroyed');
    }
}
