/**
 * @fileoverview Music Tab Component for Serenity Hub
 * Provides music player controls, playlist browser, and volume settings
 */

import { csIcon } from '../components/cosmic-icons.js';

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
        this.songs = this.soundManager.songsData || [];
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

        // Clear loading message
        container.innerHTML = `
            <div class="music-tab">
                <!-- Compact Now Playing + Controls Section -->
                <div class="now-playing-section">
                    <div class="now-playing-header">
                        <span class="music-icon">${csIcon('note', 20)}</span>
                        <h3>Now Playing</h3>
                    </div>
                    <div class="now-playing-card">
                        <div class="album-art">
                            <div class="vinyl-disc ${this.isPlaying() ? 'spinning' : ''}">
                                <div class="vinyl-center"></div>
                            </div>
                        </div>
                        <div class="track-controls-container">
                            <div class="track-info">
                                <div class="track-title" id="current-track-title">
                                    ${this.getCurrentSongName()}
                                </div>
                                <div class="track-artist">Serenity Blocks</div>
                            </div>

                            <div class="playback-controls-section">
                                <div class="progress-container">
                                    <div class="time-display">
                                        <span id="current-time">0:00</span>
                                        <span id="total-time">0:00</span>
                                    </div>
                                    <div class="progress-bar-container">
                                        <div class="progress-bar">
                                            <div class="progress-fill" id="progress-fill"></div>
                                            <div class="progress-handle" id="progress-handle"></div>
                                        </div>
                                    </div>
                                </div>

                                <div class="main-controls">
                                    <button class="control-btn secondary" id="prev-track" title="Previous Track">
                                        <span class="control-icon">${csIcon('prev', 20)}</span>
                                    </button>
                                    <button class="control-btn primary" id="play-pause" title="${this.isPlaying() ? 'Pause' : 'Play'}">
                                        <span class="control-icon">${csIcon(this.isPlaying() ? 'pause' : 'play', 22)}</span>
                                    </button>
                                    <button class="control-btn secondary" id="next-track" title="Next Track">
                                        <span class="control-icon">${csIcon('next', 20)}</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Volume Controls Section -->
                <div class="volume-section">
                    <div class="volume-controls-stack">
                        <div class="volume-control">
                            <label class="volume-label">
                                <span class="volume-icon">${csIcon('note', 16)}</span>
                                Music Volume
                            </label>
                            <div class="volume-slider-container">
                                <input
                                    type="range"
                                    class="volume-slider"
                                    id="hub-music-volume"
                                    min="0"
                                    max="100"
                                    value="${Math.round(this.soundManager.musicVolume * 100)}"
                                >
                                <span class="volume-value" id="hub-music-volume-value">
                                    ${Math.round(this.soundManager.musicVolume * 100)}%
                                </span>
                            </div>
                        </div>

                        <div class="volume-control">
                            <label class="volume-label">
                                <span class="volume-icon">${csIcon('volume', 16)}</span>
                                SFX Volume
                            </label>
                            <div class="volume-slider-container">
                                <input
                                    type="range"
                                    class="volume-slider"
                                    id="hub-sfx-volume"
                                    min="0"
                                    max="100"
                                    value="${Math.round(this.soundManager.sfxVolume * 100)}"
                                >
                                <span class="volume-value" id="hub-sfx-volume-value">
                                    ${Math.round(this.soundManager.sfxVolume * 100)}%
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="volume-actions">
                        <button
                            class="mute-btn ${this.soundManager.isMuted ? 'muted' : ''}"
                            id="mute-toggle"
                            aria-pressed="${this.soundManager.isMuted ? 'true' : 'false'}"
                            title="${this.soundManager.isMuted ? 'Unmute' : 'Mute'}"
                        >
                            <span class="mute-icon">${csIcon(this.soundManager.isMuted ? 'mute' : 'volume', 18)}</span>
                            <span class="mute-text">${this.soundManager.isMuted ? 'Unmute' : 'Mute'}</span>
                        </button>
                    </div>
                </div>

                <!-- Playlist Section -->
                <div class="playlist-section">
                    <div class="playlist-header">
                        <h3>Playlist</h3>
                        <span class="track-count">${this.songs.length} tracks</span>
                    </div>
                    <div class="playlist-container" id="playlist-container">
                        ${this.renderPlaylist()}
                    </div>
                </div>
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
            'current-track-title', 'current-time', 'total-time', 'progress-fill', 'progress-handle',
        ].forEach((id) => this.getNode(id));
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
        target?.addEventListener(type, handler, { ...options, signal: this.domAbortController.signal });
    }

    /**
     * Renders the playlist items
     * @returns {string} HTML string for playlist
     */
    renderPlaylist() {
        // Sort songs alphabetically by name
        const sortedSongs = [...this.songs].sort((a, b) => a.name.localeCompare(b.name));

        return sortedSongs.map((song, index) => {
            const songKey = this.nameToKey(song.name);
            const isActive = songKey === this.currentSong;

            return `
                <div class="playlist-item ${isActive ? 'active' : ''}" data-track="${songKey}" tabindex="0">
                    <div class="playlist-item-number">${(index + 1).toString().padStart(2, '0')}</div>
                    <div class="playlist-item-info">
                        <div class="playlist-item-title">${song.name}</div>
                        <div class="playlist-item-artist">Serenity Blocks</div>
                    </div>
                    <div class="playlist-item-icon">
                        ${isActive ? `<span class="playing-indicator">${csIcon('equalizer', 16)}</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
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
            });
        }

        // Mute toggle button
        const muteBtn = this.getNode('mute-toggle');
        if (muteBtn) {
            this.listen(muteBtn, 'click', () => this.toggleMute());
        }

        // Progress bar scrubbing
        const { progressBar } = this.nodes;
        if (progressBar) {
            this.listen(progressBar, 'click', (e) => this.seekToPosition(e));
        }

        // Playlist items
        const playlistItems = this.container?.querySelectorAll('.playlist-item') || [];
        playlistItems.forEach((item) => {
            this.listen(item, 'click', () => {
                const trackKey = item.dataset.track;
                this.selectTrack(trackKey);
            });
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
    togglePlayPause() {
        const { audioElement } = this.soundManager;

        if (!audioElement) {
            // Start music if not playing
            this.soundManager.startBackgroundMusic();
            this.updatePlayPauseButton(true);
            this.updateVinylAnimation(true);
            return;
        }

        if (audioElement.paused) {
            audioElement.play();
            this.updatePlayPauseButton(true);
            this.updateVinylAnimation(true);
        } else {
            audioElement.pause();
            this.updatePlayPauseButton(false);
            this.updateVinylAnimation(false);
        }
    }

    /**
     * Goes to previous track
     */
    previousTrack() {
        const currentIndex = this.songs.findIndex((s) => this.nameToKey(s.name) === this.currentSong);
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : this.songs.length - 1;
        const prevTrack = this.nameToKey(this.songs[prevIndex].name);
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
        this.soundManager.setTrack(trackKey);
        this.currentSong = trackKey;
        this.audibleSong = this.getAudibleTrackKey() || trackKey;
        this.updateNowPlaying();
        this.updatePlaylist();
        this.updatePlayPauseButton(true);
        this.updateVinylAnimation(true);
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
            muteBtn.title = 'Unmute';
            if (muteIcon) muteIcon.innerHTML = csIcon('mute', 18);
            if (muteText) muteText.textContent = 'Unmute';
            this.updateVinylAnimation(false);
        } else {
            muteBtn.classList.remove('muted');
            muteBtn.setAttribute('aria-pressed', 'false');
            muteBtn.title = 'Mute';
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

    /**
     * Updates the now playing display
     */
    updateNowPlaying() {
        const titleElement = this.getNode('current-track-title');
        if (titleElement) {
            this.setLabel(titleElement, this.getCurrentSongName(this.audibleSong || this.currentSong));
        }
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
                item.querySelector('.playlist-item-icon').innerHTML = `<span class="playing-indicator">${csIcon('equalizer', 16)}</span>`;
            } else {
                item.classList.remove('active');
                item.querySelector('.playlist-item-icon').innerHTML = '';
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
            playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
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
    }

    resetProgressBar() {
        const fill = this.getNode('progress-fill');
        const handle = this.getNode('progress-handle');
        if (fill) fill.style.transform = 'scaleX(0)';
        if (handle) handle.style.transform = 'translate(-50%, -50%)';
        this.lastProgress = 0;
        this.setLabel(this.getNode('current-time'), '0:00');
        this.setLabel(this.getNode('total-time'), '0:00');
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
        return name.replace(/\s+/g, '');
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
        this.resizeObserver?.disconnect();
        this.pendingTimeouts.forEach((timer) => clearTimeout(timer));
        this.pendingTimeouts.clear();
        this.nodes = {};
        this.container = null;
    }
}
