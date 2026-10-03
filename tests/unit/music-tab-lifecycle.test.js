import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicTab } from '../../src/ui/serenity-hub/MusicTab.js';
import { SettingsManager } from '../../src/ui/settings.js';

function createNode(id) {
    const node = new EventTarget();
    const classes = new Set();
    node.id = id;
    node.value = '';
    node.style = {};
    node.textWrites = 0;
    let label = '';
    Object.defineProperty(node, 'textContent', {
        get: () => label,
        set: (value) => { label = value; node.textWrites++; },
    });
    node.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
    };
    node.querySelector = () => ({ innerHTML: '' });
    return node;
}

function createHarness({ open = false, paused = false } = {}) {
    const nodes = new Map(['play-pause', 'prev-track', 'next-track', 'mute-toggle',
        'hub-music-volume', 'hub-music-volume-value', 'hub-sfx-volume', 'hub-sfx-volume-value',
        'current-track-title', 'current-time', 'total-time', 'progress-fill', 'progress-handle',
        '.progress-bar-container', '.vinyl-disc',
    ].map((id) => [id, createNode(id)]));
    nodes.get('.progress-bar-container').clientWidth = 200;
    const container = {
        innerHTML: '',
        querySelector: vi.fn((selector) => nodes.get(selector.startsWith('#') ? selector.slice(1) : selector)),
        querySelectorAll: () => [],
    };
    const document = new EventTarget();
    const settingsSlider = createNode('music-volume');
    document.hidden = false;
    document.body = createNode('body');
    document.getElementById = vi.fn((id) => (id === 'tab-music' ? container : settingsSlider));
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', new EventTarget());
    const settingsManager = new SettingsManager();
    settingsManager.save({ emitEvent: false });
    const audio = new EventTarget();
    Object.assign(audio, { paused, currentTime: 30, duration: 120, ended: false });
    const soundManager = {
        audioElement: audio,
        songsData: [{ name: 'Calm Song' }],
        musicTrack: 'CalmSong', musicVolume: 0.5, sfxVolume: 0.5,
        setMusicVolume: vi.fn(), setSFXVolume: vi.fn(),
    };
    const hub = {
        isOpen: open, currentTab: 'music',
        panel: { querySelector: () => container },
        serenityMode: { deps: { settingsManager, soundManager } },
    };
    const tab = new MusicTab(hub, soundManager);
    return { tab, nodes, container, document, hub, settingsManager, soundManager, settingsSlider, audio };
}

let tabs;
beforeEach(() => {
    vi.useFakeTimers();
    tabs = [];
    const store = new Map();
    vi.stubGlobal('localStorage', {
        getItem: (key) => store.get(key) || null,
        setItem: vi.fn((key, value) => store.set(key, value)),
    });
});
afterEach(() => {
    tabs.forEach((tab) => tab.destroy());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function harness(options) {
    const result = createHarness(options);
    tabs.push(result.tab);
    return result;
}

describe('MusicTab UI lifecycle', () => {
    it('uses unique scoped sliders and exactly one settings-driven gain update per input', () => {
        const h = harness({ open: true });
        expect(h.container.innerHTML).toContain('id="hub-music-volume"');
        expect(h.container.innerHTML).not.toContain('id="music-volume"');
        window.addEventListener('settingsChanged', (event) => {
            if (event.detail.musicVolume !== undefined) h.soundManager.setMusicVolume(event.detail.musicVolume);
        });
        h.settingsSlider.value = '10';
        h.settingsSlider.dispatchEvent(new Event('input'));
        expect(h.soundManager.setMusicVolume).not.toHaveBeenCalled();
        const slider = h.nodes.get('hub-music-volume');
        slider.value = '72';
        slider.dispatchEvent(new Event('input'));
        expect(h.settingsManager.get().musicVolume).toBe(0.72);
        expect(h.soundManager.setMusicVolume).toHaveBeenCalledExactlyOnceWith(0.72);
        slider.dispatchEvent(new Event('change'));
        expect(JSON.parse(localStorage.getItem(h.settingsManager.STORAGE_KEY)).musicVolume).toBe(0.72);
        h.tab.destroy();
        slider.value = '15';
        slider.dispatchEvent(new Event('input'));
        expect(h.soundManager.setMusicVolume).toHaveBeenCalledTimes(1);
    });

    it('starts no timers closed, stops on inactive/hidden/paused, and resumes only when visible and playing', () => {
        const h = harness();
        expect(vi.getTimerCount()).toBe(0);
        h.hub.isOpen = true;
        h.tab.setActive(true);
        expect(vi.getTimerCount()).toBe(1);
        h.audio.paused = true;
        h.audio.dispatchEvent(new Event('pause'));
        expect(vi.getTimerCount()).toBe(0);
        h.audio.paused = false;
        h.audio.dispatchEvent(new Event('play'));
        expect(vi.getTimerCount()).toBe(1);
        h.document.hidden = true;
        h.document.dispatchEvent(new Event('visibilitychange'));
        expect(vi.getTimerCount()).toBe(0);
        h.document.hidden = false;
        h.document.dispatchEvent(new Event('visibilitychange'));
        expect(vi.getTimerCount()).toBe(1);
        h.tab.setActive(false);
        expect(vi.getTimerCount()).toBe(0);
        h.audio.dispatchEvent(new Event('play'));
        expect(vi.getTimerCount()).toBe(0);
        h.tab.setActive(true);
        h.tab.destroy();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('uses cached progress nodes, changes labels once per second, and avoids hidden DOM updates', () => {
        const h = harness({ open: true });
        vi.advanceTimersByTime(100);
        h.container.querySelector.mockClear();
        const current = h.nodes.get('current-time');
        const total = h.nodes.get('total-time');
        const currentWrites = current.textWrites;
        const totalWrites = total.textWrites;
        h.audio.currentTime = 30.5;
        vi.advanceTimersByTime(200);
        expect(current.textWrites).toBe(currentWrites);
        expect(total.textWrites).toBe(totalWrites);
        expect(h.container.querySelector).not.toHaveBeenCalled();
        expect(h.nodes.get('progress-fill').style.transform).toBe(`scaleX(${30.5 / 120})`);
        expect(h.nodes.get('progress-fill').style.width).toBe('100%');
        h.audio.currentTime = 31;
        vi.advanceTimersByTime(100);
        expect(current.textWrites).toBe(currentWrites + 1);
        h.tab.setActive(false);
        const transform = h.nodes.get('progress-fill').style.transform;
        h.audio.currentTime = 40;
        h.audio.dispatchEvent(new Event('seeked'));
        window.dispatchEvent(new CustomEvent('musicTrackChanged', { detail: { trackName: 'Other' } }));
        vi.advanceTimersByTime(1000);
        expect(h.nodes.get('progress-fill').style.transform).toBe(transform);
        expect(current.textWrites).toBe(currentWrites + 1);
    });

    it('rebinds replacement audio listeners and removes drag listeners on hide/destroy', () => {
        const h = harness({ open: true });
        vi.advanceTimersByTime(100);
        const oldAudio = h.audio;
        const newAudio = new EventTarget();
        Object.assign(newAudio, { paused: false, currentTime: 5, duration: 60, ended: false });
        h.soundManager.audioElement = newAudio;
        h.tab.syncWithAudioState();
        const sync = vi.spyOn(h.tab, 'syncWithAudioState');
        oldAudio.dispatchEvent(new Event('pause'));
        expect(sync).not.toHaveBeenCalled();
        newAudio.paused = true;
        newAudio.dispatchEvent(new Event('pause'));
        expect(sync).toHaveBeenCalledTimes(1);
        const slider = h.nodes.get('hub-music-volume');
        slider.dispatchEvent(new Event('pointerdown'));
        expect(h.document.body.classList.contains('serenity-volume-dragging')).toBe(true);
        h.tab.setActive(false);
        expect(h.document.body.classList.contains('serenity-volume-dragging')).toBe(false);
        h.tab.destroy();
        sync.mockClear();
        newAudio.dispatchEvent(new Event('play'));
        expect(sync).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });
});
