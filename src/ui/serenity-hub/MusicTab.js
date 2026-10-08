/**
 * @fileoverview Music Tab Component for Serenity Hub
 * Provides music player controls, playlist browser, and volume settings
 */

import { csIcon } from '../components/cosmic-icons.js';
import { THEME_MUSIC_CATALOG } from '../../core/progression/theme-music-catalog.js';
import { MusicCollectionView } from './MusicCollectionView.js';

/** The game's own name: never printed as the artist of its own soundtrack. */
const GAME_ARTIST = 'serenity blocks';
const TRACK_KEYS_BY_NAME = new Map(THEME_MUSIC_CATALOG.map((song) => [song.name, song.trackKey]));
const SEEK_STEPS = {
    ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30,
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export class MusicTab {
    constructor(hubInstance, soundManager) {
        this.hub = hubInstance;
        this.soundManager = soundManager;
        this.serenityMode = hubInstance.serenityMode;
        this.currentSong = null;
        this.audibleSong = null;
        this.songs = [];
        this.updateInterval = null;
        this.reconcilePromise = null;
        this.active = false;
        this.destroyed = false;
        this.nodes = {};
        this.domAbortController = new AbortController();
        this.audioElement = null;
        this.audioAbortController = null;
        this.pendingTimeouts = new Set();
        this.init();
    }

    /**
     * Initializes the music tab
     */
    async init() {
        const context = this.serenityMode.deps || {};
        const collection = context.themeCollection || this.soundManager.themeCollection;
        this.songs = collection ? THEME_MUSIC_CATALOG : this.soundManager.songsData || [];
        this.collectionView = collection ? new MusicCollectionView(this, collection, context) : null;
        this.currentSong = this.soundManager.musicTrack;
        this.audibleSong = this.getAudibleTrackKey() || this.currentSong;
        this.render();
        this.attachEventListeners();
        this.listenForTrackChanges();
        this.listenForAudioEvents();

        // Sync initial state with actual audio element (with small delay for audio loading)
        this.setActive(this.hub.isOpen && this.hub.currentTab === 'music');
        if (this.active) this.scheduleSync();
    }

    /**
     * Renders the music tab content
     */
    render() {
        const container = this.hub.panel?.querySelector('#tab-music') || document.getElementById('tab-music');
        this.container = container;
        if (!container) {
            console.error('[MusicTab] Container not found');
            return;
        }

        const playing = this.isPlaying();
        const musicPercent = Math.round(this.soundManager.musicVolume * 100);
        const sfxPercent = Math.round(this.soundManager.sfxVolume * 100);
        const muted = Boolean(this.soundManager.isMuted);
        // Now playing (play / pause is the tab's one primary action), volume, the playlist.
        container.innerHTML = `
            <div class="music-tab">
                <section class="now-playing-section" aria-labelledby="music-now-playing-label">
                    <div class="now-playing-card">
                        <div class="album-art" aria-hidden="true">
                            <div class="vinyl-disc${playing ? ' spinning' : ''}">${csIcon('note', 42)}</div>
                        </div>
                        <div class="track-controls-container">
                            <div class="track-info">
                                <p class="sb-eyebrow" id="music-now-playing-label">Now playing</p>
                                <h3 class="track-title" id="current-track-title">
                                    ${escapeHtml(this.getCurrentSongName())}</h3>
                                <p class="track-meta" id="current-track-meta">${escapeHtml(this.getTrackMeta())}</p>
                            </div>

                            <div class="playback-controls-section">
                                <div class="progress-container">
                                    <span id="current-time">0:00</span>
                                    <div class="progress-bar-container" role="slider" tabindex="0"
                                        aria-label="Position in track" aria-valuemin="0" aria-valuemax="0"
                                        aria-valuenow="0" aria-valuetext="0:00">
                                        <div class="progress-bar">
                                            <div class="progress-fill" id="progress-fill"></div>
                                            <div class="progress-handle" id="progress-handle"></div>
                                        </div>
                                    </div>
                                    <span id="total-time">0:00</span>
                                </div>

                                <div class="main-controls">
                                    <button type="button" class="control-btn secondary" id="prev-track"
                                        aria-label="Previous track">
                                        <span class="control-icon">${csIcon('prev', 18)}</span>
                                    </button>
                                    <button type="button" class="control-btn primary" id="play-pause"
                                        aria-label="${playing ? 'Pause' : 'Play'}">
                                        <span class="control-icon">${csIcon(playing ? 'pause' : 'play', 22)}</span>
                                    </button>
                                    <button type="button" class="control-btn secondary" id="next-track"
                                        aria-label="Next track">
                                        <span class="control-icon">${csIcon('next', 18)}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section class="volume-section" aria-labelledby="music-volume-label">
                    <p class="sb-eyebrow" id="music-volume-label">Volume</p>
                    <div class="volume-controls-stack">
                        <div class="volume-control">
                            <label class="volume-label" for="hub-music-volume">
                                <span class="volume-icon" aria-hidden="true">${csIcon('note', 16)}</span>
                                Music
                            </label>
                            <div class="volume-slider-container">
                                <input type="range" class="volume-slider" id="hub-music-volume"
                                    min="0" max="100" value="${musicPercent}">
                                <span class="volume-value" id="hub-music-volume-value"
                                    aria-hidden="true">${musicPercent}%</span>
                            </div>
                        </div>

                        <div class="volume-control">
                            <label class="volume-label" for="hub-sfx-volume">
                                <span class="volume-icon" aria-hidden="true">${csIcon('volume', 16)}</span>
                                Sound effects
                            </label>
                            <div class="volume-slider-container">
                                <input type="range" class="volume-slider" id="hub-sfx-volume"
                                    min="0" max="100" value="${sfxPercent}">
                                <span class="volume-value" id="hub-sfx-volume-value"
                                    aria-hidden="true">${sfxPercent}%</span>
                            </div>
                        </div>
                    </div>

                    <div class="volume-actions">
                        <button type="button" class="mute-btn${muted ? ' muted' : ''}" id="mute-toggle"
                            aria-pressed="${muted ? 'true' : 'false'}">
                            <span class="mute-icon" aria-hidden="true">${csIcon(muted ? 'mute' : 'volume', 18)}</span>
                            <span class="mute-text">${muted ? 'Unmute' : 'Mute'}</span>
                        </button>
                    </div>
                </section>

                <section class="playlist-section" aria-labelledby="music-playlist-title">
                    <div class="playlist-header">
                        <h3 id="music-playlist-title">${this.collectionView ? 'Your soundtrack' : 'Playlist'}</h3>
                        <span class="track-count">${this.collectionView?.countLabel()
        || `${this.songs.length} tracks`}</span>
                    </div>
                    ${this.collectionView?.renderIntro() || ''}
                    <div class="playlist-container" id="playlist-container">
                        ${this.renderPlaylist()}
                    </div>
                </section>
            </div>
        `;
        this.cacheNodes();
    }

    getNode(id) {
        if (!Object.prototype.hasOwnProperty.call(this.nodes, id)) {
            this.nodes[id] = this.container?.querySelector(`#${id}`) || null;
        }
        return this.nodes[id];
    }

    cacheNodes() {
        this.nodes = {};
        ['play-pause', 'prev-track', 'next-track', 'mute-toggle',
            'hub-music-volume', 'hub-music-volume-value', 'hub-sfx-volume', 'hub-sfx-volume-value',
            'current-track-title', 'current-track-meta', 'current-time', 'total-time', 'progress-fill',
            'progress-handle',
        ].forEach((id) => this.getNode(id));
        this.paintSlider(this.getNode('hub-music-volume'));
        this.paintSlider(this.getNode('hub-sfx-volume'));
        this.nodes.progressBar = this.container?.querySelector('.progress-bar-container');
        this.nodes.vinylDisc = this.container?.querySelector('.vinyl-disc');
        const fill = this.nodes['progress-fill'];
        if (fill) {
            fill.style.width = '100%';
            fill.style.transformOrigin = 'left center';
            fill.style.transition = 'transform 0.1s linear';
            fill.style.transform = 'scaleX(0)';
        }
        const handle = this.nodes['progress-handle'];
        if (handle) handle.style.transition = 'transform 0.1s linear';
        if (typeof ResizeObserver !== 'undefined' && this.nodes.progressBar) {
            this.resizeObserver = new ResizeObserver(([entry]) => {
                this.progressWidth = entry.contentRect.width;
                this.lastProgress = null;
                if (this.active) this.updateProgressBar();
            });
            this.resizeObserver.observe(this.nodes.progressBar);
        }
    }

    listen(target, type, handler, options = {}) {
        target?.addEventListener?.(type, handler, { ...options, signal: this.domAbortController.signal });
    }

    /**
     * Renders the playlist items
     * @returns {string} HTML string for playlist
     */
    renderPlaylist() {
        // Sort songs alphabetically by name
        const sortedSongs = this.collectionView?.orderSongs(this.songs)
            || [...this.songs].sort((a, b) => a.name.localeCompare(b.name));

        return sortedSongs.map((song, index) => {
            const songKey = this.nameToKey(song.name);
            const isActive = songKey === this.currentSong;
            const locked = this.collectionView && !this.collectionView.state(songKey).owned;
            // A row names its artist only when it is not the game itself.
            const artist = song.artist && String(song.artist).trim().toLowerCase() !== GAME_ARTIST
                ? `<span class="playlist-item-artist">${escapeHtml(song.artist)}</span>` : '';

            return `
                <button type="button" class="playlist-item${isActive ? ' active' : ''}${locked ? ' is-locked' : ''}"
                    data-track="${escapeHtml(songKey)}"
                    ${locked ? `aria-label="${escapeHtml(song.name)}, locked. View unlock details"` : ''}
                    ${isActive ? 'aria-current="true"' : ''}>
                    <span class="playlist-item-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
                    <span class="playlist-item-info">
                        <span class="playlist-item-title">${escapeHtml(song.name)}</span>${artist}
                        ${this.collectionView?.renderRowCopy(songKey) || ''}
                    </span>
                    <span class="playlist-item-icon" aria-hidden="true">
                        ${isActive ? `<span class="playing-indicator">${csIcon('equalizer', 16)}</span>`
        : this.collectionView?.rowIcon(songKey) || ''}
                    </span>
                </button>
            `;
        }).join('');
    }

    /** "Track 09 of 36": the now-playing card's place in the playlist below it. */
    getTrackMeta(trackKey = this.audibleSong || this.currentSong) {
        if (this.collectionView) {
            const state = this.collectionView.state(trackKey);
            if (state.themeId) {
                return state.owned
                    ? `${state.themeName} · Collected`
                    : 'Playing in Odyssey · Not collected yet';
            }
        }
        const sorted = [...this.songs].sort((a, b) => a.name.localeCompare(b.name));
        const index = sorted.findIndex((song) => this.nameToKey(song.name) === trackKey);
        if (index < 0) return `${sorted.length} tracks`;
        return `Track ${String(index + 1).padStart(2, '0')} of ${sorted.length}`;
    }

    /** The slider's spectrum fill runs to its value (keystone-hub.css reads --fill). */
    paintSlider(slider) {
        if (slider) slider.style?.setProperty?.('--fill', `${slider.value}%`);
    }

    /**
     * Attaches event listeners to controls
     */
    attachEventListeners() {
        // Play/Pause button
        const playPauseBtn = this.getNode('play-pause');
        if (playPauseBtn) {
            this.listen(playPauseBtn, 'click', () => this.togglePlayPause());
        }

        // Previous track button
        const prevBtn = this.getNode('prev-track');
        if (prevBtn) {
            this.listen(prevBtn, 'click', () => this.previousTrack());
        }

        // Next track button
        const nextBtn = this.getNode('next-track');
        if (nextBtn) {
            this.listen(nextBtn, 'click', () => this.nextTrack());
        }

        const clearDrag = () => {
            document.body.classList.remove('serenity-volume-dragging');
            this.dragAbortController?.abort();
            this.dragAbortController = null;
        };
        this.clearVolumeDrag = clearDrag;
        const setVolumeDragActive = (slider) => {
            this.listen(slider, 'pointerdown', () => {
                clearDrag();
                document.body.classList.add('serenity-volume-dragging');
                this.dragAbortController = new AbortController();
                const { signal } = this.dragAbortController;
                document.addEventListener('pointerup', clearDrag, { signal });
                document.addEventListener('pointercancel', clearDrag, { signal });
                window.addEventListener('blur', clearDrag, { signal });
            });
            this.listen(slider, 'blur', clearDrag);
            this.listen(slider, 'change', () => this.serenityMode.deps?.settingsManager?.flushPendingSave?.());
        };

        // Music volume slider
        const musicVolumeSlider = this.getNode('hub-music-volume');
        if (musicVolumeSlider) {
            setVolumeDragActive(musicVolumeSlider);
            this.listen(musicVolumeSlider, 'input', (e) => {
                const volume = parseInt(e.target.value, 10) / 100;
                this.previewVolume('musicVolume', volume);
                this.getNode('hub-music-volume-value').textContent = `${e.target.value}%`;
                this.paintSlider(e.target);
            });
        }

        // SFX volume slider
        const sfxVolumeSlider = this.getNode('hub-sfx-volume');
        if (sfxVolumeSlider) {
            setVolumeDragActive(sfxVolumeSlider);
            this.listen(sfxVolumeSlider, 'input', (e) => {
                const volume = parseInt(e.target.value, 10) / 100;
                this.previewVolume('sfxVolume', volume);
                this.getNode('hub-sfx-volume-value').textContent = `${e.target.value}%`;
                this.paintSlider(e.target);
            });
        }

        // Mute toggle button
        const muteBtn = this.getNode('mute-toggle');
        if (muteBtn) {
            this.listen(muteBtn, 'click', () => this.toggleMute());
        }

        // Progress bar: click to seek; as a slider, the arrows, Page keys and Home/End seek.
        const { progressBar } = this.nodes;
        if (progressBar) {
            this.listen(progressBar, 'click', (e) => this.seekToPosition(e));
            this.listen(progressBar, 'keydown', (e) => this.seekByKey(e));
        }

        // Playlist items
        this.listen(this.container, 'click', (event) => {
            const { target } = event;
            const item = target.closest?.('.playlist-item');
            if (item) this.selectTrack(item.dataset.track);
            else if (target.closest?.('[data-music-explore], [data-music-detail-close]')) {
                this.collectionView?.handleAction(target).catch((error) => {
                    console.warn('[MusicTab] Collection navigation failed:', error);
                });
            }
        });
    }

    previewVolume(key, volume) {
        const settingsManager = this.serenityMode.deps?.settingsManager;
        if (settingsManager?.update) {
            settingsManager.update({ [key]: volume });
            if (settingsManager.scheduleSave) settingsManager.scheduleSave();
            else settingsManager.save?.();
        } else if (key === 'musicVolume') this.soundManager.setMusicVolume(volume);
        else this.soundManager.setSFXVolume(volume);
    }

    closeCollectionDetails() {
        return this.collectionView?.closeDetails() || false;
    }

    scheduleSync() {
        const timer = setTimeout(() => {
            this.pendingTimeouts.delete(timer);
            if (this.active && !this.destroyed) this.syncWithAudioState();
        }, 100);
        this.pendingTimeouts.add(timer);
    }

    /**
     * Toggles play/pause state
     */
    async togglePlayPause() {
        const { audioElement } = this.soundManager;
        try {
            if (!audioElement || audioElement.paused) await this.soundManager.resumeBackgroundMusic();
            else await this.soundManager.pauseAudioElement(false);
        } catch (error) {
            console.warn('[MusicTab] Playback control failed:', error);
        }
        this.syncWithAudioState();
    }

    /**
     * Goes to previous track
     */
    previousTrack() {
        const songs = this.soundManager.getSelectableSongs?.() || this.songs.filter((song) => (
            !this.collectionView || this.collectionView.state(this.nameToKey(song.name)).owned
        ));
        if (!songs.length) return;
        const currentIndex = songs.findIndex((s) => this.nameToKey(s.name) === this.currentSong);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : songs.length - 1;
        const prevTrack = this.nameToKey(songs[prevIndex].name);
        this.selectTrack(prevTrack);
    }

    /**
     * Goes to next track
     */
    nextTrack() {
        this.soundManager.nextTrack();
        // Update UI after a short delay to ensure soundManager has updated
        this.scheduleSync();
    }

    /**
     * Selects and plays a specific track
     * @param {string} trackKey - Track key to play
     */
    selectTrack(trackKey) {
        if (this.collectionView && !this.collectionView.state(trackKey).owned) {
            this.collectionView.showDetails(trackKey);
            return false;
        }
        if (this.soundManager.canSelectTrack?.(trackKey) === false) return false;
        if (this.soundManager.setTrack(trackKey) === false) {
            const status = this.container?.querySelector('[data-music-collection-status]');
            if (status) status.textContent = 'This orb guides the music. Finish or leave it to choose a song.';
            return false;
        }
        this.currentSong = this.soundManager.musicTrack;
        this.audibleSong = this.getAudibleTrackKey() || this.currentSong;
        this.updateNowPlaying();
        this.updatePlaylist();
        this.updatePlayPauseButton(this.isPlaying());
        this.updateVinylAnimation(this.isPlaying());
        return true;
    }

    /**
     * Toggles mute state
     */
    toggleMute() {
        const isMuted = this.soundManager.toggleMute();
        const muteBtn = this.getNode('mute-toggle');
        if (!muteBtn) return;

        const muteIcon = muteBtn.querySelector('.mute-icon');
        const muteText = muteBtn.querySelector('.mute-text');

        if (isMuted) {
            muteBtn.classList.add('muted');
            muteBtn.setAttribute('aria-pressed', 'true');
            if (muteIcon) muteIcon.innerHTML = csIcon('mute', 18);
            if (muteText) muteText.textContent = 'Unmute';
            this.updateVinylAnimation(false);
        } else {
            muteBtn.classList.remove('muted');
            muteBtn.setAttribute('aria-pressed', 'false');
            if (muteIcon) muteIcon.innerHTML = csIcon('volume', 18);
            if (muteText) muteText.textContent = 'Mute';
            this.updateVinylAnimation(true);
        }
    }

    /**
     * Seeks to a position in the track
     * @param {MouseEvent} e - Click event on progress bar
     */
    seekToPosition(e) {
        const { audioElement } = this.soundManager;
        if (!audioElement) return;

        const progressBar = e.currentTarget;
        const rect = progressBar.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percentage = clickX / rect.width;

        audioElement.currentTime = percentage * audioElement.duration;
        this.updateProgressBar();
    }

    /** Keyboard seeking on the progress slider: 5 s per arrow, 30 s per Page key. */
    seekByKey(event) {
        const { audioElement } = this.soundManager;
        const { duration } = audioElement || {};
        if (!audioElement || !(Number.isFinite(duration) && duration > 0)) return;
        let next = null;
        if (SEEK_STEPS[event.key] !== undefined) next = audioElement.currentTime + SEEK_STEPS[event.key];
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = duration;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        audioElement.currentTime = Math.max(0, Math.min(duration - 0.25, next));
        this.lastProgress = null;
        this.updateProgressBar();
    }

    /**
     * Updates the now playing display
     */
    updateNowPlaying() {
        const titleElement = this.getNode('current-track-title');
        if (titleElement) {
            this.setLabel(titleElement, this.getCurrentSongName(this.audibleSong || this.currentSong));
        }
        this.setLabel(this.getNode('current-track-meta'), this.getTrackMeta());
    }

    /**
     * Updates the playlist active state
     */
    updatePlaylist() {
        const playlistItems = this.container?.querySelectorAll('.playlist-item') || [];
        playlistItems.forEach((item) => {
            const trackKey = item.dataset.track;
            const isActive = trackKey === this.currentSong;
            if (item.classList.contains('active') === isActive) return;
            if (isActive) {
                item.classList.add('active');
                item.setAttribute('aria-current', 'true');
                item.querySelector('.playlist-item-icon').innerHTML = `<span class="playing-indicator">${csIcon('equalizer', 16)}</span>`;
            } else {
                item.classList.remove('active');
                item.removeAttribute('aria-current');
                item.querySelector('.playlist-item-icon').innerHTML = this.collectionView?.rowIcon(trackKey) || '';
            }
        });
    }

    /**
     * Updates the play/pause button
     * @param {boolean} isPlaying - Whether music is playing
     */
    updatePlayPauseButton(isPlaying) {
        const playPauseBtn = this.getNode('play-pause');
        if (playPauseBtn && this.lastPlaying !== isPlaying) {
            this.lastPlaying = isPlaying;
            const icon = playPauseBtn.querySelector('.control-icon');
            if (icon) icon.innerHTML = csIcon(isPlaying ? 'pause' : 'play', 22);
            playPauseBtn.setAttribute?.('aria-label', isPlaying ? 'Pause' : 'Play');
        }
    }

    /**
     * Updates the vinyl disc animation
     * @param {boolean} isPlaying - Whether music is playing
     */
    updateVinylAnimation(isPlaying) {
        const { vinylDisc } = this.nodes;
        if (vinylDisc) {
            if (isPlaying) {
                vinylDisc.classList.add('spinning');
            } else {
                vinylDisc.classList.remove('spinning');
            }
        }
    }

    /**
     * Starts tracking playback progress
     */
    setActive(active) {
        this.active = Boolean(active) && !this.destroyed;
        if (this.active) {
            this.collectionView?.activate();
            this.progressWidth = this.nodes.progressBar?.clientWidth || this.progressWidth || 0;
            this.lastProgress = null;
            this.syncWithAudioState();
            this.syncVolumeControls();
        } else {
            this.stopProgressTracking();
            this.updateVinylAnimation(false);
            this.clearVolumeDrag?.();
            this.pendingTimeouts.forEach((timer) => clearTimeout(timer));
            this.pendingTimeouts.clear();
            this.serenityMode.deps?.settingsManager?.flushPendingSave?.();
        }
    }

    syncVolumeControls() {
        const settings = this.serenityMode.deps?.settingsManager?.get?.() || this.soundManager;
        [['musicVolume', 'hub-music'], ['sfxVolume', 'hub-sfx']].forEach(([key, prefix]) => {
            const slider = this.getNode(`${prefix}-volume`);
            const value = this.getNode(`${prefix}-volume-value`);
            const percent = Math.round(settings[key] * 100);
            if (slider) slider.value = percent;
            this.paintSlider(slider);
            if (value) this.setLabel(value, `${percent}%`);
        });
    }

    startProgressTracking() {
        const { audioElement: audio } = this.soundManager;
        if (!this.active || this.destroyed || !audio || audio.paused || audio.ended) {
            this.stopProgressTracking();
            return;
        }
        if (this.updateInterval !== null) return;
        this.updateInterval = setInterval(() => {
            if (!this.active || this.soundManager.audioElement?.paused) this.stopProgressTracking();
            else this.updateProgressBar();
        }, 100);
    }

    stopProgressTracking() {
        if (this.updateInterval !== null) clearInterval(this.updateInterval);
        this.updateInterval = null;
    }

    setLabel(node, text) {
        if (node && node.textContent !== text) node.textContent = text;
    }

    updateProgressBar() {
        if (!this.active || this.destroyed) return;
        const { audioElement } = this.soundManager;
        if (!audioElement) {
            this.resetProgressBar();
            this.stopProgressTracking();
            return;
        }
        const { duration } = audioElement;
        const loaded = Number.isFinite(duration) && duration > 0;
        const currentTime = Number.isFinite(audioElement.currentTime) ? audioElement.currentTime : 0;
        const progress = loaded ? Math.max(0, Math.min(1, currentTime / duration)) : 0;
        if (progress !== this.lastProgress) {
            this.lastProgress = progress;
            const fill = this.getNode('progress-fill');
            const handle = this.getNode('progress-handle');
            if (fill) fill.style.transform = `scaleX(${progress})`;
            if (handle) handle.style.transform = `translateX(${progress * (this.progressWidth || 0)}px) translate(-50%, -50%)`;
        }
        this.setLabel(this.getNode('current-time'), this.formatTime(currentTime));
        this.setLabel(this.getNode('total-time'), loaded ? this.formatTime(duration) : '--:--');
        this.setSeekValue(currentTime, loaded ? duration : 0);
    }

    /** The progress slider's value for assistive tech, written only when a second turns. */
    setSeekValue(now, max) {
        const bar = this.nodes.progressBar;
        if (typeof bar?.setAttribute !== 'function') return;
        const text = max > 0 ? `${this.formatTime(now)} of ${this.formatTime(max)}` : '0:00';
        if (this.lastSeekText === text) return;
        this.lastSeekText = text;
        bar.setAttribute('aria-valuemax', String(Math.floor(max)));
        bar.setAttribute('aria-valuenow', String(Math.floor(now)));
        bar.setAttribute('aria-valuetext', text);
    }

    resetProgressBar() {
        const fill = this.getNode('progress-fill');
        const handle = this.getNode('progress-handle');
        if (fill) fill.style.transform = 'scaleX(0)';
        if (handle) handle.style.transform = 'translate(-50%, -50%)';
        this.lastProgress = 0;
        this.setLabel(this.getNode('current-time'), '0:00');
        this.setLabel(this.getNode('total-time'), '0:00');
        this.setSeekValue(0, 0);
    }

    /**
     * Formats time in seconds to MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string
     */
    formatTime(seconds) {
        if (!Number.isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Gets the current song name
     * @returns {string} Current song display name
     */
    getCurrentSongName(trackKey = this.audibleSong || this.currentSong) {
        const song = this.songs.find((s) => this.nameToKey(s.name) === trackKey);
        return song ? song.name : 'No track selected';
    }

    /**
     * Checks if music is currently playing
     * @returns {boolean} True if playing
     */
    isPlaying() {
        const { audioElement } = this.soundManager;
        return audioElement && !audioElement.paused && !this.soundManager.isMuted;
    }

    getAudibleTrackKey() {
        if (typeof this.soundManager.getActualTrackKey === 'function') {
            return this.soundManager.getActualTrackKey();
        }
        return this.soundManager.musicTrack || null;
    }

    reconcileTrackMismatch() {
        if (this.reconcilePromise || typeof this.soundManager.ensureTrackPlaybackSynced !== 'function') {
            return;
        }

        this.reconcilePromise = Promise.resolve(
            this.soundManager.ensureTrackPlaybackSynced({
                reason: 'music-tab-reconcile',
                force: true,
            }),
        )
            .catch((error) => {
                console.warn('[MusicTab] Failed to reconcile playback state:', error);
            })
            .finally(() => {
                this.reconcilePromise = null;
            });
    }

    /**
     * Converts display name to key
     * @param {string} name - Display name
     * @returns {string} Key name
     */
    nameToKey(name) {
        return TRACK_KEYS_BY_NAME.get(name) || name.replace(/\s+/g, '');
    }

    /**
     * Listen for track changes from external sources (like keyboard shortcut)
     */
    listenForTrackChanges() {
        this.trackChangeHandler = () => {
            this.currentSong = this.soundManager.musicTrack;
            if (this.active) {
                this.updatePlaylist();
                this.syncWithAudioState();
            }
        };
        this.listen(window, 'musicTrackChanged', this.trackChangeHandler);
        this.listen(window, 'settingsChanged', (event) => {
            if (this.active && (event.detail?.musicVolume !== undefined || event.detail?.sfxVolume !== undefined)) {
                this.syncVolumeControls();
            }
        });
        this.listen(document, 'visibilitychange', () => {
            this.setActive(!document.hidden && this.hub.isOpen && this.hub.currentTab === 'music');
        });
        this.listen(window, 'pagehide', () => {
            this.setActive(false);
        });
    }

    listenForAudioEvents() {
        const { audioElement } = this.soundManager;
        if (this.audioElement === audioElement) return;
        this.audioAbortController?.abort();
        this.audioElement = audioElement;
        this.audioAbortController = new AbortController();
        if (!audioElement) return;
        const { signal } = this.audioAbortController;
        const sync = () => {
            if (this.active) this.syncWithAudioState();
        };
        ['play', 'pause', 'ended', 'loadedmetadata', 'seeked'].forEach((type) => {
            audioElement.addEventListener(type, sync, { signal });
        });
    }

    /**
     * Syncs the UI state with the actual audio element state
     * Called on initialization to ensure UI matches reality
     */
    syncWithAudioState() {
        if (!this.active || this.destroyed) return;
        this.listenForAudioEvents();
        const { audioElement } = this.soundManager;

        if (!audioElement) {
            console.log('[MusicTab] No audio element found - UI showing default state');
            this.updatePlayPauseButton(false);
            this.updateVinylAnimation(false);
            this.resetProgressBar();
            this.stopProgressTracking();
            return;
        }

        // Sync play/pause state
        const isPlaying = !audioElement.paused && !audioElement.ended;

        this.updatePlayPauseButton(isPlaying);
        this.updateVinylAnimation(isPlaying && !this.soundManager.isMuted);

        // Selected track is UI state; audible track is derived from the audio source.
        const selectedTrack = this.soundManager.musicTrack;
        if (selectedTrack && selectedTrack !== this.currentSong) {
            this.currentSong = selectedTrack;
            this.updatePlaylist();
        }

        const audibleTrack = this.getAudibleTrackKey() || selectedTrack;
        if (audibleTrack && audibleTrack !== this.audibleSong) {
            this.audibleSong = audibleTrack;
            this.updateNowPlaying();
        } else if (!this.audibleSong) {
            this.audibleSong = selectedTrack;
            this.updateNowPlaying();
        }

        if (
            selectedTrack
            && audibleTrack
            && selectedTrack !== audibleTrack
            && !this.soundManager.isMuted
        ) {
            this.reconcileTrackMismatch();
        }

        this.updateProgressBar();
        this.startProgressTracking();
    }

    /**
     * Cleans up the music tab
     */
    destroy() {
        this.setActive(false);
        this.destroyed = true;
        this.domAbortController.abort();
        this.audioAbortController?.abort();
        this.collectionView?.destroy();
        this.resizeObserver?.disconnect();
        this.pendingTimeouts.forEach((timer) => clearTimeout(timer));
        this.pendingTimeouts.clear();
        this.nodes = {};
        this.container = null;
    }
}
