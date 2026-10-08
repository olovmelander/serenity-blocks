import { getThemeForMusic } from '../../core/progression/theme-music-catalog.js';
import { getThemeMeta } from '../../themes/theme-registry.js';
import { THEME_LOCK_ICON } from './ThemeCollectionView.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function getMusicCollectionState(trackKey, collection) {
    const themeId = getThemeForMusic(trackKey);
    const status = themeId && collection?.getThemeStatus(themeId);
    return {
        themeId,
        owned: status ? status.owned : !collection,
        developmentAccess: Boolean(status?.developmentAccess),
        themeName: getThemeMeta(themeId)?.displayName || '',
        requirement: status?.requirement?.label || 'Continue Odyssey to collect this song.',
    };
}

/** Songs share the theme receipt; this view never stores a second unlock state. */
export class MusicCollectionView {
    constructor(tab, collection, context = {}) {
        this.tab = tab;
        this.collection = collection;
        this.context = context;
        this.dirty = false;
        this.inspectedTrack = null;
        this.unsubscribe = collection.subscribe(() => {
            this.dirty = true;
            if (tab.active) this.refresh();
        });
    }

    state(trackKey) { return getMusicCollectionState(trackKey, this.collection); }

    orderSongs(songs) {
        return [...songs].sort((left, right) => {
            const leftOwned = this.state(this.tab.nameToKey(left.name)).owned;
            const rightOwned = this.state(this.tab.nameToKey(right.name)).owned;
            return Number(rightOwned) - Number(leftOwned) || left.name.localeCompare(right.name);
        });
    }

    countLabel() {
        const owned = this.tab.songs.filter((song) => this.state(this.tab.nameToKey(song.name)).owned).length;
        const label = this.collection.getSummary?.().developmentUnlockAll ? 'available' : 'collected';
        return `${owned} / ${this.tab.songs.length} ${label}`;
    }

    renderIntro() {
        const note = this.collection.getSummary?.().developmentUnlockAll
            ? 'Temporary development access via unlockAll=1. Remove the URL option to restore song locks.'
            : 'Each Odyssey world brings a song home. Collect its theme and music together.';
        return `<p class="music-collection-note">${note}</p>`
            + '<section class="music-collection-detail" aria-labelledby="music-detail-title" hidden></section>'
            + '<p class="hub-sr-only" data-music-collection-status role="status" aria-live="polite"></p>';
    }

    renderRowCopy(trackKey) {
        const state = this.state(trackKey);
        return `<span class="playlist-item-collection">${state.owned
            ? `${escapeHtml(state.themeName)} · ${state.developmentAccess ? 'Development access' : 'Collected'}`
            : `Locked · ${escapeHtml(state.requirement)}`}</span>`;
    }

    rowIcon(trackKey) { return this.state(trackKey).owned ? '' : THEME_LOCK_ICON; }

    refresh() {
        this.dirty = false;
        const { container } = this.tab;
        const playlist = container?.querySelector('#playlist-container');
        const focusedTrack = globalThis.document?.activeElement?.dataset?.track;
        if (playlist) {
            playlist.innerHTML = this.tab.renderPlaylist();
            if (focusedTrack) {
                [...playlist.querySelectorAll('[data-track]')]
                    .find((row) => row.dataset.track === focusedTrack)?.focus({ preventScroll: true });
            }
        }
        const count = container?.querySelector('.track-count');
        if (count) count.textContent = this.countLabel();
        if (this.inspectedTrack) this.showDetails(this.inspectedTrack, { focus: false });
        this.tab.updateNowPlaying();
    }

    activate() {
        this.collection.reconcileFromOdyssey?.(undefined, { silent: true });
        if (this.dirty) this.refresh();
        else if (this.inspectedTrack) this.showDetails(this.inspectedTrack, { focus: false });
    }

    getRouteAvailability() {
        const route = this.context.canExploreTheme?.();
        if (typeof this.context.onExploreTheme === 'function' && (route === true || route?.allowed)) {
            return { allowed: true };
        }
        return { allowed: false, reason: route?.reason || 'Return to the main menu to continue your Odyssey.' };
    }

    showDetails(trackKey, { focus = true } = {}) {
        const song = this.tab.songs.find((entry) => this.tab.nameToKey(entry.name) === trackKey);
        const detail = this.tab.container?.querySelector('.music-collection-detail');
        if (!song || !detail) return false;
        const previousFocus = globalThis.document?.activeElement;
        const ownedFocus = previousFocus && detail.contains(previousFocus);
        const focusAction = ['explore', 'detail-close'].find((action) => (
            previousFocus?.matches?.(`[data-music-${action}]`)
        ));
        const state = this.state(trackKey);
        const route = this.getRouteAvailability();
        this.inspectedTrack = trackKey;
        detail.hidden = false;
        let eyebrow = state.owned ? 'Collected' : 'A song to discover';
        let copy = state.owned ? `Yours with ${state.themeName}. Choose this song below to listen.`
            : `${state.requirement} Unlock ${state.themeName} and its song together.`;
        if (state.developmentAccess) {
            eyebrow = 'Development access';
            copy = `Temporarily available through the URL option. ${state.requirement} `
                + 'Collect its theme and song to keep them.';
        }
        detail.innerHTML = `<p class="sb-eyebrow">${eyebrow}</p>
            <h4 id="music-detail-title" tabindex="-1">${escapeHtml(song.name)}</h4>
            <p>${escapeHtml(copy)}</p>
            ${state.owned ? '' : `<button type="button" class="sb-btn sb-btn--primary" data-music-explore
                ${route.allowed ? '' : 'disabled'}>Continue Odyssey <span aria-hidden="true">→</span></button>
                ${route.allowed ? '' : `<p class="music-detail-route-note">${escapeHtml(route.reason)}</p>`}`}
            <button type="button" class="sb-btn music-detail-close" data-music-detail-close>Back to songs</button>`;
        if (focus || ownedFocus) {
            const action = !focus && focusAction
                && detail.querySelector(`[data-music-${focusAction}]:not([disabled])`);
            (action || detail.querySelector('#music-detail-title'))?.focus({ preventScroll: !focus });
        }
        return true;
    }

    closeDetails() {
        const trackKey = this.inspectedTrack;
        if (!trackKey) return false;
        this.inspectedTrack = null;
        const detail = this.tab.container?.querySelector('.music-collection-detail');
        if (detail) detail.hidden = true;
        [...(this.tab.container?.querySelectorAll('[data-track]') || [])]
            .find((row) => row.dataset.track === trackKey)?.focus({ preventScroll: true });
        return true;
    }

    async handleAction(target) {
        if (target.closest('[data-music-detail-close]')) { this.closeDetails(); return; }
        if (!target.closest('[data-music-explore]') || !this.inspectedTrack) return;
        const state = this.state(this.inspectedTrack);
        if (state.owned || !this.getRouteAvailability().allowed) return;
        await this.context.onExploreTheme(state.themeId);
    }

    destroy() { this.unsubscribe?.(); }
}
