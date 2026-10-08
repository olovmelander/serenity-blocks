import {
    afterEach, describe, expect, it, vi,
} from 'vitest';
import { ThemesTab } from '../../src/ui/serenity-hub/ThemesTab.js';
import {
    ThemeCollectionView, filterCollectionThemeIds, getCollectionCardPresentation, getCollectionPersistenceMessage,
} from '../../src/ui/serenity-hub/ThemeCollectionView.js';
import { looseNode, targetMatching } from './helpers/loose-dom.js';

const THEMES = [
    { id: 'forest', displayName: 'Forest', group: 'biomes' },
    { id: 'ocean', displayName: 'Ocean', group: 'biomes' },
    { id: 'aurora', displayName: 'Aurora', group: 'sky' },
];

function harness({ owned = ['forest'], isNew = [], context = {} } = {}) {
    const ownedIds = new Set(owned);
    const newIds = new Set(isNew);
    let notify;
    const unsubscribe = vi.fn();
    const collection = {
        isUnlocked: (id) => ownedIds.has(id),
        getOwnedThemeIds: () => [...ownedIds],
        getSummary: () => ({ owned: ownedIds.size, total: THEMES.length, newCount: newIds.size }),
        getThemeStatus: (id) => ({
            themeId: id,
            owned: ownedIds.has(id),
            isNew: newIds.has(id),
            requirement: { type: 'orb', levelId: 8, label: 'Complete Odyssey orb 8 · Ocean Depths.' },
        }),
        markSeen: vi.fn((id) => { newIds.delete(id); }),
        subscribe: vi.fn((fn) => { notify = fn; return unsubscribe; }),
    };
    const tab = Object.create(ThemesTab.prototype);
    const container = looseNode();
    const scroller = { scrollTop: 360 };
    Object.assign(tab, {
        active: true,
        themes: THEMES,
        currentTheme: 'forest',
        selectedCategory: 'all',
        searchQuery: '',
        tabContainer: container,
        hub: { getScrollContainer: () => scroller },
        themeManager: { activeThemeName: 'forest', switchTheme: vi.fn() },
        refreshThemeGrid: vi.fn(),
        hydrateVisibleThemeCardIcons: vi.fn(),
        selectTheme: vi.fn(async (id) => { tab.themeManager.activeThemeName = id; }),
        getCategoryDisplayName: (id) => id,
        themeCardElements: new Map(THEMES.map((theme) => [theme.id, looseNode()])),
    });
    const view = new ThemeCollectionView(tab, collection, context);
    tab.collectionView = view;
    return {
        view, tab, collection, container, scroller, ownedIds, notify: () => notify(), unsubscribe,
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme collection discovery and ownership', () => {
    it('labels URL preview access without claiming a permanent collection', () => {
        const h = harness();
        h.collection.getSummary = () => ({
            owned: 3, total: 3, newCount: 0, earned: 1, developmentUnlockAll: true,
        });
        h.collection.getThemeStatus = (id) => ({
            owned: true,
            isNew: false,
            ...(id !== 'forest' ? { developmentAccess: true } : {}),
            requirement: { label: 'Complete Odyssey orb 8 · Ocean Depths.' },
        });
        const state = getCollectionCardPresentation(THEMES[1], h.collection, 'ocean');
        expect(state).toMatchObject({ owned: true, current: true, label: 'Development access' });
        const header = h.view.renderHeader();
        expect(header).toContain('of 3 available');
        expect(header).toContain('1 / 3 collected');
        expect(header).toContain('Remove the URL option to restore locks.');
        h.view.open('ocean');
        const detail = h.container.querySelector('.theme-collection-detail').innerHTML;
        expect(detail).toContain('Development access');
        expect(detail).toContain('Song available temporarily');
        expect(detail).not.toContain('This world is yours.');
        expect(detail).not.toContain('Song collected');
    });

    it('keeps locked themes inspectable with an exact requirement and accessible action', () => {
        const h = harness();
        const state = getCollectionCardPresentation(THEMES[1], h.collection, 'forest');
        expect(state).toMatchObject({ owned: false, current: false, label: 'Locked' });
        expect(state.accessibleLabel).toBe('Ocean, locked. View theme details');
        expect(state.requirement).toBe('Complete Odyssey orb 8 · Ocean Depths.');
        h.tab.getThemeIcon = () => '<img alt="" />';
        const cards = h.tab.renderThemeCards();
        expect((cards.match(/role="button"/g) || []).length).toBe(3);
        expect(cards).toContain('data-theme="ocean"');
        expect(cards).toContain('is-locked');
        expect(cards).toContain('tabindex="0"');
        expect(cards).not.toContain('aria-disabled="true"');
    });

    it('does not call a locked campaign scene an owned current selection', () => {
        const h = harness();
        const state = getCollectionCardPresentation(THEMES[1], h.collection, 'ocean');
        expect(state.current).toBe(false);
        expect(state.label).toBe('Locked');
    });

    it('counts unique collection ownership and marks new worlds separately', () => {
        const h = harness({ owned: ['forest', 'ocean'], isNew: ['ocean'] });
        expect(h.view.renderHeader()).toContain('>2</strong>');
        expect(h.view.renderHeader()).toContain('1 new world to explore');
        expect(getCollectionCardPresentation(THEMES[1], h.collection, 'forest').label).toBe('New');
        h.view.open('ocean');
        expect(h.collection.markSeen).toHaveBeenCalledWith('ocean');
        expect(getCollectionCardPresentation(THEMES[1], h.collection, 'forest').label).toBe('Collected');
        expect(h.tab.selectTheme).not.toHaveBeenCalled();
    });

    it('combines collection, category and search filters without mutating the catalog', () => {
        const h = harness({ owned: ['forest', 'ocean'] });
        h.tab.searchQuery = 'ocean';
        h.tab.selectedCategory = 'biomes';
        h.view.filter = 'owned';
        expect(h.tab.getVisibleThemeIds()).toEqual(['ocean']);
        h.view.filter = 'locked';
        expect(h.tab.getVisibleThemeIds()).toEqual([]);
        expect(h.tab.searchQuery).toBe('ocean');
        expect(h.tab.selectedCategory).toBe('biomes');
        expect(filterCollectionThemeIds(['forest', 'ocean', 'aurora'], h.collection, 'all'))
            .toEqual(['forest', 'ocean', 'aurora']);
    });

    it('opens a locked theme without switching or loading its active renderer', () => {
        const h = harness();
        h.view.open('ocean');
        const detail = h.container.querySelector('.theme-collection-detail');
        expect(detail.innerHTML).toContain('Complete Odyssey orb 8 · Ocean Depths.');
        expect(detail.innerHTML).not.toContain('data-collection-apply');
        expect(h.tab.themeManager.switchTheme).not.toHaveBeenCalled();
        expect(h.tab.selectTheme).not.toHaveBeenCalled();
        expect(h.scroller.scrollTop).toBe(0);
        expect(h.container.querySelector('#theme-detail-title').focused).toBe(1);
    });

    it('returns to the source card and prior scroll position when details close', () => {
        const h = harness();
        h.view.open('ocean');
        expect(h.tab.closeCollectionDetails()).toBe(true);
        expect(h.scroller.scrollTop).toBe(360);
        expect(h.tab.themeCardElements.get('ocean').focused).toBe(1);
        expect(h.container.querySelector('.themes-collection-browse').hidden).toBe(false);
        expect(h.tab.closeCollectionDetails()).toBe(false);
    });

    it('will not navigate away from a live session even when the action is invoked directly', async () => {
        const onExploreTheme = vi.fn();
        const h = harness({
            context: {
                onExploreTheme,
                canExploreTheme: () => ({ allowed: false, reason: 'Finish your current game first.' }),
            },
        });
        h.view.open('ocean');
        expect(h.container.querySelector('.theme-collection-detail').innerHTML)
            .toContain('Finish your current game first.');
        await h.view.handleAction(targetMatching({ '[data-collection-explore]': true }));
        expect(onExploreTheme).not.toHaveBeenCalled();
    });

    it('passes an inspectable theme intent to the application only when routing is available', async () => {
        const onExploreTheme = vi.fn();
        const h = harness({ context: { onExploreTheme, canExploreTheme: () => true } });
        h.view.open('ocean');
        await h.view.handleAction(targetMatching({ '[data-collection-explore]': true }));
        expect(onExploreTheme).toHaveBeenCalledExactlyOnceWith('ocean');
    });

    it('requires an explicit Apply action and rechecks ownership before selecting', async () => {
        const h = harness({ owned: ['forest', 'ocean'] });
        h.view.open('ocean');
        expect(h.tab.selectTheme).not.toHaveBeenCalled();
        await h.view.handleAction(targetMatching({ '[data-collection-apply]': true }));
        expect(h.tab.selectTheme).toHaveBeenCalledExactlyOnceWith('ocean');
        expect(h.container.querySelector('.theme-detail-feedback').textContent).toBe('Theme applied.');
        h.view.open('aurora');
        await h.view.handleAction(targetMatching({ '[data-collection-apply]': true }));
        expect(h.tab.selectTheme).toHaveBeenCalledTimes(1);
    });

    it('guards the public tab selection against locked themes independently of card markup', async () => {
        const h = harness();
        await ThemesTab.prototype.selectTheme.call(h.tab, 'ocean');
        expect(h.view.detailThemeId).toBe('ocean');
        expect(h.tab.themeManager.switchTheme).not.toHaveBeenCalled();
    });

    it('holds Apply and random during an authored Odyssey orb even for owned themes', async () => {
        const h = harness({ owned: ['forest', 'ocean'] });
        h.tab.themeManager.isOdysseyThemeScopeActive = () => true;
        h.tab.themeManager.canSelectTheme = () => false;
        h.view.open('ocean');
        expect(h.container.querySelector('.theme-collection-detail').innerHTML)
            .toContain('Finish or leave this orb to change your theme.');
        await h.view.handleAction(targetMatching({ '[data-collection-apply]': true }));
        await ThemesTab.prototype.selectRandomTheme.call(h.tab);
        await ThemesTab.prototype.selectTheme.call(h.tab, 'ocean');
        expect(h.tab.selectTheme).not.toHaveBeenCalled();
        expect(h.tab.themeManager.switchTheme).not.toHaveBeenCalled();
    });

    it('puts owned worlds first and retains that order when a new world is collected', () => {
        const h = harness();
        expect(h.view.orderThemes(THEMES).map((theme) => theme.id)).toEqual(['forest', 'aurora', 'ocean']);
        h.ownedIds.add('ocean');
        h.notify();
        expect(h.view.orderThemes(THEMES).map((theme) => theme.id)).toEqual(['forest', 'aurora', 'ocean']);
    });

    it('does no hidden collection presentation work, then updates in place without reordering cards', () => {
        const h = harness();
        h.tab.active = false;
        const query = vi.spyOn(h.container, 'querySelector');
        const before = [...h.tab.themeCardElements.keys()];
        h.ownedIds.add('ocean');
        h.notify();
        expect(query).not.toHaveBeenCalled();
        expect(h.view.dirty).toBe(true);
        h.tab.active = true;
        h.view.refresh();
        expect(h.view.dirty).toBe(false);
        expect(h.container.querySelector('[data-collection-owned]').textContent).toBe(2);
        expect([...h.tab.themeCardElements.keys()]).toEqual(before);
        h.view.destroy();
        expect(h.unsubscribe).toHaveBeenCalledOnce();
    });

    it('disables random selection when Forest is the only owned theme', async () => {
        const h = harness();
        h.view.refresh();
        expect(h.container.querySelector('#random-theme-btn').disabled).toBe(true);
        await ThemesTab.prototype.selectRandomTheme.call(h.tab);
        expect(h.tab.selectTheme).not.toHaveBeenCalled();
    });

    it('random selection can only draw another collected world', async () => {
        const h = harness({ owned: ['forest', 'ocean'] });
        await ThemesTab.prototype.selectRandomTheme.call(h.tab);
        expect(h.tab.selectTheme).toHaveBeenCalledExactlyOnceWith('ocean');
    });

    it('quietly retries saved progress once per activation, without retrying on renders', () => {
        const h = harness();
        h.collection.reconcileFromOdyssey = vi.fn();
        h.tab.active = false;
        h.tab.refreshCurrentTheme = vi.fn();
        h.tab.setActive(true);
        expect(h.collection.reconcileFromOdyssey).toHaveBeenCalledExactlyOnceWith(undefined, { silent: true });
        h.view.refresh();
        h.tab.setActive(true);
        expect(h.collection.reconcileFromOdyssey).toHaveBeenCalledTimes(1);
    });

    it('shows actual save failures and clears the message after successful recovery', () => {
        const h = harness();
        let status = 'write-failed';
        h.collection.getPersistenceStatus = () => ({ status });
        h.view.refresh();
        const message = h.container.querySelector('[data-collection-save-status]');
        expect(message.hidden).toBe(false);
        expect(message.textContent).toContain('Your collection could not be saved yet.');
        status = 'ready';
        h.view.refresh();
        expect(message.hidden).toBe(true);
        expect(message.textContent).toBe('');
    });

    it.each(['backup-failed', 'storage-unavailable', 'unsupported-version'])('names %s', (status) => {
        const collection = { getPersistenceStatus: () => ({ status }) };
        expect(getCollectionPersistenceMessage(collection).length).toBeGreaterThan(0);
        expect(getCollectionPersistenceMessage({})).toBe('');
    });
});
