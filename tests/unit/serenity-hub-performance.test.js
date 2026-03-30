import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    applyThemeCardFilter,
    createThemeIconObserverOptions,
    getFilteredThemeIds,
    getThemeIconHydrationPlan,
    resolveThemeIconHydrationSource,
} from '../../src/ui/serenity-hub/ThemesTab.js';
import {
    resolveHubScrollContainer,
    scrollHubElementIntoView,
    scrollHubScrollContainer,
    scrollHubScrollContainerFromWheelEvent,
} from '../../src/ui/serenity-hub/hub-scroll-utils.js';

function createFakeClassList() {
    const classes = new Set();
    return {
        add(name) {
            classes.add(name);
        },
        remove(name) {
            classes.delete(name);
        },
        toggle(name, force) {
            if (force === undefined) {
                if (classes.has(name)) {
                    classes.delete(name);
                    return false;
                }
                classes.add(name);
                return true;
            }

            if (force) {
                classes.add(name);
                return true;
            }

            classes.delete(name);
            return false;
        },
        contains(name) {
            return classes.has(name);
        },
    };
}

function createFakeCard(themeId) {
    const attributes = new Map();
    return {
        dataset: { theme: themeId },
        hidden: false,
        tabIndex: 0,
        classList: createFakeClassList(),
        setAttribute(name, value) {
            attributes.set(name, value);
        },
        getAttribute(name) {
            return attributes.get(name);
        },
    };
}

function createFakeIcon(id) {
    return {
        dataset: {
            themeIconSrc: `/icons/${id}.png`,
        },
    };
}

function createFakeHydrationCard(themeId, rect) {
    const icon = createFakeIcon(themeId);
    return {
        hidden: false,
        querySelectorAll(selector) {
            if (selector === '.theme-icon-img[data-theme-icon-src]') {
                return [icon];
            }
            return [];
        },
        getBoundingClientRect() {
            return rect;
        },
    };
}

describe('Serenity Hub performance helpers', () => {
    it('filters and sorts theme ids without rebuilding the source list', () => {
        const themes = [
            { id: 'winter', displayName: 'Winter', group: 'biomes' },
            { id: 'aurora', displayName: 'Aurora', group: 'sky' },
            { id: 'forest', displayName: 'Forest', group: 'biomes' },
        ];

        expect(getFilteredThemeIds(themes, 'all', '')).toEqual(['aurora', 'forest', 'winter']);
        expect(getFilteredThemeIds(themes, 'biomes', 'for')).toEqual(['forest']);
    });

    it('updates existing theme card nodes in place when filtering', () => {
        const forestCard = createFakeCard('forest');
        const winterCard = createFakeCard('winter');
        const auroraCard = createFakeCard('aurora');
        const cards = [forestCard, winterCard, auroraCard];

        const visibleCount = applyThemeCardFilter(cards, ['aurora', 'forest']);

        expect(visibleCount).toBe(2);
        expect(cards[0]).toBe(forestCard);
        expect(cards[1]).toBe(winterCard);
        expect(cards[2]).toBe(auroraCard);
        expect(forestCard.hidden).toBe(false);
        expect(forestCard.tabIndex).toBe(0);
        expect(winterCard.hidden).toBe(true);
        expect(winterCard.tabIndex).toBe(-1);
        expect(winterCard.classList.contains('is-filtered-out')).toBe(true);
        expect(winterCard.getAttribute('aria-hidden')).toBe('true');
        expect(auroraCard.hidden).toBe(false);
    });

    it('scopes icon observer options to the hub scroll container', () => {
        const scrollContainer = { id: 'hub-scroll-root' };

        expect(createThemeIconObserverOptions(scrollContainer)).toEqual({
            root: scrollContainer,
            rootMargin: '180px 0px',
            threshold: 0.01,
        });
    });

    it('eagerly prioritizes the first visible row of theme icons', () => {
        const cards = [
            createFakeHydrationCard('forest', {
                top: 10,
                bottom: 150,
            }),
            createFakeHydrationCard('aurora', {
                top: 14,
                bottom: 154,
            }),
            createFakeHydrationCard('winter', {
                top: 190,
                bottom: 330,
            }),
        ];
        const scrollContainer = {
            getBoundingClientRect() {
                return {
                    top: 0,
                    bottom: 220,
                };
            },
        };

        const plan = getThemeIconHydrationPlan(cards, { scrollContainer });

        expect(plan.immediateIcons).toHaveLength(2);
        expect(plan.deferredIcons).toHaveLength(1);
        expect(plan.immediateIcons[0].dataset.themeIconSrc).toBe('/icons/forest.png');
        expect(plan.immediateIcons[1].dataset.themeIconSrc).toBe('/icons/aurora.png');
        expect(plan.deferredIcons[0].dataset.themeIconSrc).toBe('/icons/winter.png');
    });

    it('keeps bundled theme icons as the default packaged Electron source', () => {
        const icon = {
            dataset: {
                themeIconSrc: '/icons/forest.png',
                themeDesktopIconSrc: '/assets/theme-thumbnails/forest-theme-icon.png',
            },
        };

        expect(resolveThemeIconHydrationSource(icon, {
            isElectron: true,
            isPackaged: true,
        })).toEqual({
            src: '/icons/forest.png',
            source: 'bundled',
        });

        expect(resolveThemeIconHydrationSource(icon, {
            isElectron: true,
            isPackaged: true,
            desktopThemeThumbnails: true,
        })).toEqual({
            src: '/assets/theme-thumbnails/forest-theme-icon.png',
            source: 'desktop',
        });
    });

    it('routes manual/gamepad scrolling to the shared hub scroll container', () => {
        const activePanel = { scrollTop: 0 };
        const scrollContainer = { scrollTop: 24 };
        const panel = {
            querySelector(selector) {
                if (selector === '.hub-tab-content') {
                    return scrollContainer;
                }
                if (selector === '.tab-panel.active') {
                    return activePanel;
                }
                return null;
            },
        };

        expect(resolveHubScrollContainer(panel)).toBe(scrollContainer);
        expect(scrollHubScrollContainer(panel, 90)).toBe(true);
        expect(scrollContainer.scrollTop).toBe(114);
        expect(activePanel.scrollTop).toBe(0);
    });

    it('manually scrolls the hub content for wheel input when native scrolling stalls', () => {
        const preventDefault = vi.fn();
        const stopPropagation = vi.fn();
        const scrollContainer = {
            scrollTop: 40,
            scrollHeight: 480,
            clientHeight: 180,
        };
        const panel = {
            querySelector(selector) {
                if (selector === '.hub-tab-content') {
                    return scrollContainer;
                }
                return null;
            },
        };

        expect(scrollHubScrollContainerFromWheelEvent(panel, {
            deltaY: 32,
            deltaMode: 0,
            preventDefault,
            stopPropagation,
        })).toBe(true);
        expect(scrollContainer.scrollTop).toBe(72);
        expect(preventDefault).toHaveBeenCalledTimes(1);
        expect(stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('uses auto scroll behavior for hub focus navigation', () => {
        const scrollIntoView = vi.fn();
        const target = { scrollIntoView };

        expect(scrollHubElementIntoView(target, { block: 'center' })).toBe(true);
        expect(scrollIntoView).toHaveBeenCalledWith({
            behavior: 'auto',
            block: 'center',
            inline: 'nearest',
        });
    });
});
