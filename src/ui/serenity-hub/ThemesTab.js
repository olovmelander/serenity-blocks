/**
 * @fileoverview Themes Tab Component for Serenity Hub
 * Provides theme browser with visual swatches and category filtering
 */

import { THEME_REGISTRY } from '../../themes/theme-registry.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

export class ThemesTab {
    constructor(hubInstance, themeManager, settingsManager) {
        this.hub = hubInstance;
        this.themeManager = themeManager;
        this.settingsManager = settingsManager;
        this.serenityMode = hubInstance.serenityMode;

        this.themes = THEME_REGISTRY;
        this.currentTheme = this.themeManager.activeThemeName;
        this.selectedCategory = 'all';

        // Group themes by category
        this.categories = this.getCategories();

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
            Spring: '🌸',
            Aurora: '🌌',
            Galaxy: '🌌',
            'Rainy Window': '🌧️',
            'Koi Pond': '🐟',
            Meadow: '🌼',
            'Cosmic Chimes': '🎐',
            'Singing Bowl': '🔔',
            Starlight: '⭐',
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
                <!-- Header with category filter -->
                <div class="themes-header">
                    <h3 class="themes-title">Browse Themes</h3>
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
     * Render theme cards
     * @returns {string} HTML for theme cards
     */
    renderThemeCards() {
        const filteredThemes = this.selectedCategory === 'all'
            ? this.themes
            : this.themes.filter((t) => t.group === this.selectedCategory);

        if (filteredThemes.length === 0) {
            return '<div class="no-themes">No themes in this category</div>';
        }

        // Sort themes alphabetically by display name
        const sortedThemes = filteredThemes.sort((a, b) => a.displayName.localeCompare(b.displayName));

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
        // Category filter pills
        const pills = document.querySelectorAll('.category-pill');
        pills.forEach((pill) => {
            pill.addEventListener('click', () => {
                const { category } = pill.dataset;
                this.selectCategory(category);
            });
        });

        // Theme cards
        const themeCards = document.querySelectorAll('.theme-card');
        themeCards.forEach((card) => {
            card.addEventListener('click', () => {
                const themeId = card.dataset.theme;
                this.selectTheme(themeId);
            });
        });

        // Random theme button
        const randomBtn = document.getElementById('random-theme-btn');
        if (randomBtn) {
            randomBtn.addEventListener('click', () => this.selectRandomTheme());
        }
    }

    /**
     * Select a category filter
     * @param {string} category - Category ID
     */
    selectCategory(category) {
        if (this.selectedCategory === category) return;

        this.selectedCategory = category;

        // Update filter pills
        document.querySelectorAll('.category-pill').forEach((pill) => {
            pill.classList.toggle('active', pill.dataset.category === category);
        });

        // Update themes grid
        const grid = document.getElementById('themes-grid');
        if (grid) {
            grid.innerHTML = this.renderThemeCards();

            // Reattach event listeners to theme cards
            const themeCards = grid.querySelectorAll('.theme-card');
            themeCards.forEach((card) => {
                card.addEventListener('click', () => {
                    const themeId = card.dataset.theme;
                    this.selectTheme(themeId);
                });
            });
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
        const card = document.querySelector(`.theme-card[data-theme="${randomTheme.id}"]`);
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
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        // Unsubscribe from theme change events
        if (this.unsubscribeThemeChange) {
            this.unsubscribeThemeChange();
            this.unsubscribeThemeChange = null;
        }
        console.log('[ThemesTab] Destroyed');
    }
}
