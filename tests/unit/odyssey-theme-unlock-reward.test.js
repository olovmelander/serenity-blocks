import {
    afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest';
import { createThemeUnlockReward } from '../../src/ui/odyssey/ThemeUnlockReward.js';
import { createResultsModal } from '../../src/ui/odyssey/ResultsModal.js';
import { SteamLeaderboardPanel } from '../../src/ui/components/steam-leaderboard-panel.js';
import { createOdysseyFlowDom } from '../helpers/odyssey-flow-dom.js';

const nodes = (root) => [root, ...root.children.flatMap(nodes)];
const text = (root) => nodes(root).map((node) => node.textContent).join(' ');
const receipt = (overrides = {}) => ({
    persisted: true,
    themeIds: ['cinder-drift'],
    totalOwned: 2,
    totalThemes: 69,
    sourceLevelId: 1,
    ...overrides,
});

describe('Odyssey theme collection reward', () => {
    beforeEach(() => {
        const dom = createOdysseyFlowDom();
        vi.stubGlobal('document', dom.document);
        vi.stubGlobal('window', dom.window);
    });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

    it('shows durable ownership, artwork and the supplied unique collection total without an action', () => {
        const reward = createThemeUnlockReward(receipt());
        expect(text(reward)).toContain('Theme + song collected');
        expect(text(reward)).toContain('Cinder Drift');
        expect(text(reward)).toContain('2 / 69 themes');
        expect(nodes(reward).find((node) => node.tagName === 'img').src).toContain('cinder-drift');
        expect(nodes(reward).some((node) => node.tagName === 'button')).toBe(false);
        expect(reward.dataset.celebrating).toBe('true');
        expect(reward.role).toBe('status');
        expect(reward.ariaLive).toBe('polite');
        expect(document.activeElement).toBeNull();
        reward.dispose();
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
    });

    it('names every new theme in a multi-award receipt without counting duplicates', () => {
        const reward = createThemeUnlockReward(receipt({
            themeIds: ['cinder-drift', 'cinder-drift', 'pyrestorm', 'forest'],
            totalOwned: 3,
        }));
        expect(text(reward)).toContain('Themes + songs collected');
        expect(text(reward)).toContain('Also yours · Pyrestorm');
        expect(text(reward)).not.toContain('Forest');
        expect(text(reward)).toContain('3 / 69 themes');
        reward.dispose();
    });

    it('does not replay the same receipt when a results or finale sheet remounts', () => {
        const saved = receipt();
        const first = createThemeUnlockReward(saved);
        first.dispose();
        const second = createThemeUnlockReward(saved);
        expect(second.dataset.celebrating).toBe('false');
        expect(second.ariaLive).toBe('off');
        expect(text(second)).toContain('Cinder Drift');
        second.dispose();
    });

    it.each([true, false])('keeps collection feedback correct in ranked=%s detailed results', (ranked) => {
        vi.useFakeTimers();
        vi.spyOn(SteamLeaderboardPanel.prototype, 'mount').mockImplementation(() => {});
        vi.spyOn(SteamLeaderboardPanel.prototype, 'destroy').mockImplementation(() => {});
        const saved = receipt();
        const first = createThemeUnlockReward(saved);
        first.dispose();
        const modal = createResultsModal({
            results: {
                score: 1000, lines: 20, time: 30, stars: 1, themeUnlock: saved,
            },
            onClose: () => {},
            levelConfig: { name: 'Ashen Dawn' },
            levelId: 1,
            totalStars: 1,
            formatTime: () => '0:30',
            includeLegacyResults: ranked,
        });
        const reward = nodes(modal).find((node) => node.className === 'ody-theme-reward');
        vi.runOnlyPendingTimers();
        if (ranked) {
            expect(reward.dataset.celebrating).toBe('false');
            expect(text(modal)).toContain('Cinder Drift');
            expect(document.activeElement).toBe(nodes(modal).find((node) => node.tagName === 'h2'));
        } else expect(reward).toBeUndefined();
        modal.dispose();
        expect(document.listenerCount()).toBe(0);
        expect(window.listenerCount()).toBe(0);
    });

    it.each([undefined, receipt({ persisted: false }), receipt({ themeIds: [] }),
        receipt({ themeIds: ['unknown', 'forest'] })])('does not fabricate an award for %j', (saved) => {
        expect(createThemeUnlockReward(saved)).toBeNull();
        expect(document.listenerCount()).toBe(0);
    });

    it('keeps complete static feedback with reduced motion and without an audio dependency', () => {
        const reward = createThemeUnlockReward(receipt(), { reducedMotion: true });
        expect(reward.dataset.celebrating).toBe('false');
        expect(text(reward)).toContain('Theme + song collected');
        expect(text(reward)).toContain('Cinder Drift');
        reward.dispose();
    });

    it.each(['visibility', 'blur', 'pause'])('settles its flourish permanently on %s', (reason) => {
        const reward = createThemeUnlockReward(receipt());
        if (reason === 'visibility') {
            document.hidden = true;
            document.dispatch('visibilitychange');
            document.hidden = false;
            document.dispatch('visibilitychange');
        } else if (reason === 'blur') {
            window.dispatch('blur');
            window.dispatch('focus');
        } else reward.suppressCelebration();
        expect(reward.dataset.celebrating).toBe('false');
        expect(text(reward)).toContain('2 / 69 themes');
        reward.dispose();
    });

    it('never starts a flourish while the document is hidden', () => {
        document.hidden = true;
        const reward = createThemeUnlockReward(receipt());
        expect(reward.dataset.celebrating).toBe('false');
        reward.dispose();
    });

    it('omits an invalid count rather than claiming an impossible collection total', () => {
        const reward = createThemeUnlockReward(receipt({ totalOwned: 70 }));
        expect(text(reward)).not.toContain('70 / 69');
        expect(text(reward)).toContain('Yours to choose in Themes');
        reward.dispose();
    });

    it.each(['progress', 'collection'])('makes %s save failure explicit without claiming an unlock', (failure) => {
        const saved = { persisted: false, failure };
        const notice = createThemeUnlockReward(saved, { reducedMotion: true });
        expect(notice.dataset.celebrating).toBe('false');
        expect(notice.ariaLive).toBe('polite');
        expect(text(notice)).toContain('couldn’t be saved');
        expect(text(notice)).not.toContain('Theme + song collected');
        expect(text(notice)).not.toContain('themes ·');
        expect(nodes(notice).some((node) => node.tagName === 'button' || node.tagName === 'img')).toBe(false);
        expect(document.activeElement).toBeNull();
        expect(document.listenerCount()).toBe(0);
        const second = createThemeUnlockReward(saved);
        expect(second.ariaLive).toBe('off');
        if (failure === 'collection') expect(text(notice)).toContain('Your completed orb is saved');
        else expect(text(notice)).toContain('Keep the game open');
    });
    it('stages a first-time ceremony: art, theme, the song and how far the collection grew', () => {
        const reward = createThemeUnlockReward(receipt({ totalOwned: 6, totalThemes: 61 }), {
            variant: 'ceremony', nowPlaying: true,
        });
        expect(reward.className).toBe('ody-theme-reward ody-theme-reward--ceremony');
        expect(text(reward)).toContain('New theme unlocked');
        expect(text(reward)).toContain('Cinder Drift');
        expect(text(reward)).toContain('New song · Cinder Drift');
        expect(text(reward)).toContain('Playing now · yours to keep in Music');
        expect(text(reward)).toContain('6 of 61 themes collected');
        const song = nodes(reward).find((node) => node.className === 'ody-theme-reward__song');
        expect(song.dataset.nowPlaying).toBe('true');
        expect(nodes(reward).some((node) => node.className === 'ody-theme-reward__meter')).toBe(true);
        expect(nodes(reward).filter((node) => node.className === 'ody-theme-reward__spark')).toHaveLength(10);
        expect(reward.readingWords).toBeGreaterThan(12);
        expect(nodes(reward).some((node) => node.tagName === 'button')).toBe(false);
        reward.dispose();
        expect(document.listenerCount()).toBe(0);
    });

    it('never claims a song is playing when it cannot be heard, and names every extra unlock', () => {
        const reward = createThemeUnlockReward(receipt({ themeIds: ['cinder-drift', 'pyrestorm'], totalOwned: 3 }), {
            variant: 'ceremony', nowPlaying: false,
        });
        expect(text(reward)).toContain('New themes unlocked');
        expect(text(reward)).toContain('Yours to keep in Music');
        expect(text(reward)).not.toContain('Playing now');
        expect(text(reward)).toContain('Also unlocked · Pyrestorm');
        expect(nodes(reward).find((node) => node.className === 'ody-theme-reward__song').dataset.nowPlaying)
            .toBe('false');
        reward.dispose();
    });

    it('omits the collection meter rather than drawing an impossible total', () => {
        const reward = createThemeUnlockReward(receipt({ totalOwned: 70, totalThemes: 61 }), { variant: 'ceremony' });
        expect(nodes(reward).some((node) => node.className === 'ody-theme-reward__meter')).toBe(false);
        expect(text(reward)).toContain('Yours to choose in Themes');
        reward.dispose();
    });
});
