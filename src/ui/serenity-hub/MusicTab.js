/**
 * @fileoverview Music Tab Component for Serenity Hub
 * Provides music player controls, playlist browser, and volume settings
 */

export class MusicTab {
    constructor(hubInstance, soundManager) {
        this.hub = hubInstance;
        this.soundManager = soundManager;
        this.serenityMode = hubInstance.serenityMode;
        this.currentSong = null;
        this.songs = [];
        this.updateInterval = null;
        this.init();
    }

    /**
     * Initializes the music tab
     */
    async init() {
        this.songs = this.soundManager.songsData || [];
        this.currentSong = this.soundManager.musicTrack;
        this.render();
        this.attachEventListeners();
        this.startProgressTracking();
        this.listenForTrackChanges();
        this.listenForAudioEvents();

        // Sync initial state with actual audio element (with small delay for audio loading)
        setTimeout(() => this.syncWithAudioState(), 100);
    }

    /**
     * Renders the music tab content
     */
    render() {
        const container = document.getElementById('tab-music');
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
                        <span class="music-icon">🎵</span>
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
                                        <span class="control-icon">⏮</span>
                                    </button>
                                    <button class="control-btn primary" id="play-pause" title="${this.isPlaying() ? 'Pause' : 'Play'}">
                                        <span class="control-icon">${this.isPlaying() ? '⏸' : '▶'}</span>
                                    </button>
                                    <button class="control-btn secondary" id="next-track" title="Next Track">
                                        <span class="control-icon">⏭</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Volume Controls Section -->
                <div class="volume-section">
                    <button class="mute-btn ${this.soundManager.isMuted ? 'muted' : ''}" id="mute-toggle">
                        <span class="mute-icon">${this.soundManager.isMuted ? '🔇' : '🔊'}</span>
                        <span class="mute-text">${this.soundManager.isMuted ? 'Unmute' : 'Mute'}</span>
                    </button>

                    <div class="volume-control">
                        <label class="volume-label">
                            <span class="volume-icon">🎵</span>
                            Music Volume
                        </label>
                        <div class="volume-slider-container">
                            <input
                                type="range"
                                class="volume-slider"
                                id="music-volume"
                                min="0"
                                max="100"
                                value="${Math.round(this.soundManager.musicVolume * 100)}"
                            >
                            <span class="volume-value" id="music-volume-value">
                                ${Math.round(this.soundManager.musicVolume * 100)}%
                            </span>
                        </div>
                    </div>

                    <div class="volume-control">
                        <label class="volume-label">
                            <span class="volume-icon">🔊</span>
                            SFX Volume
                        </label>
                        <div class="volume-slider-container">
                            <input
                                type="range"
                                class="volume-slider"
                                id="sfx-volume"
                                min="0"
                                max="100"
                                value="${Math.round(this.soundManager.sfxVolume * 100)}"
                            >
                            <span class="volume-value" id="sfx-volume-value">
                                ${Math.round(this.soundManager.sfxVolume * 100)}%
                            </span>
                        </div>
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
    }

    /**
     * Renders the playlist items
     * @returns {string} HTML string for playlist
     */
    renderPlaylist() {
        return this.songs.map((song, index) => {
            const songKey = this.nameToKey(song.name);
            const isActive = songKey === this.currentSong;

            return `
                <div class="playlist-item ${isActive ? 'active' : ''}" data-track="${songKey}">
                    <div class="playlist-item-number">${(index + 1).toString().padStart(2, '0')}</div>
                    <div class="playlist-item-info">
                        <div class="playlist-item-title">${song.name}</div>
                        <div class="playlist-item-artist">Serenity Blocks</div>
                    </div>
                    <div class="playlist-item-icon">
                        ${isActive ? '<span class="playing-indicator">♪</span>' : ''}
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
        const playPauseBtn = document.getElementById('play-pause');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }

        // Previous track button
        const prevBtn = document.getElementById('prev-track');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.previousTrack());
        }

        // Next track button
        const nextBtn = document.getElementById('next-track');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextTrack());
        }

        // Music volume slider
        const musicVolumeSlider = document.getElementById('music-volume');
        if (musicVolumeSlider) {
            musicVolumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value) / 100;
                this.soundManager.setMusicVolume(volume);
                document.getElementById('music-volume-value').textContent = `${e.target.value}%`;

                // Save to settings
                this.serenityMode.deps.settingsManager.update({ musicVolume: volume });
            });
        }

        // SFX volume slider
        const sfxVolumeSlider = document.getElementById('sfx-volume');
        if (sfxVolumeSlider) {
            sfxVolumeSlider.addEventListener('input', (e) => {
                const volume = parseInt(e.target.value) / 100;
                this.soundManager.setSFXVolume(volume);
                document.getElementById('sfx-volume-value').textContent = `${e.target.value}%`;

                // Save to settings
                this.serenityMode.deps.settingsManager.update({ sfxVolume: volume });
            });
        }

        // Mute toggle button
        const muteBtn = document.getElementById('mute-toggle');
        if (muteBtn) {
            muteBtn.addEventListener('click', () => this.toggleMute());
        }

        // Progress bar scrubbing
        const progressBar = document.querySelector('.progress-bar-container');
        if (progressBar) {
            progressBar.addEventListener('click', (e) => this.seekToPosition(e));
        }

        // Playlist items
        const playlistItems = document.querySelectorAll('.playlist-item');
        playlistItems.forEach(item => {
            item.addEventListener('click', () => {
                const trackKey = item.dataset.track;
                this.selectTrack(trackKey);
            });
        });
    }

    /**
     * Toggles play/pause state
     */
    togglePlayPause() {
        const audioElement = this.soundManager.audioElement;

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
        const currentIndex = this.songs.findIndex(s => this.nameToKey(s.name) === this.currentSong);
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
        setTimeout(() => {
            this.currentSong = this.soundManager.musicTrack;
            this.updateNowPlaying();
            this.updatePlaylist();
        }, 100);
    }

    /**
     * Selects and plays a specific track
     * @param {string} trackKey - Track key to play
     */
    selectTrack(trackKey) {
        this.soundManager.setTrack(trackKey);
        this.currentSong = trackKey;
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
        const muteBtn = document.getElementById('mute-toggle');
        const muteIcon = muteBtn.querySelector('.mute-icon');
        const muteText = muteBtn.querySelector('.mute-text');

        if (isMuted) {
            muteBtn.classList.add('muted');
            muteIcon.textContent = '🔇';
            muteText.textContent = 'Unmute';
            this.updateVinylAnimation(false);
        } else {
            muteBtn.classList.remove('muted');
            muteIcon.textContent = '🔊';
            muteText.textContent = 'Mute';
            this.updateVinylAnimation(true);
        }
    }

    /**
     * Seeks to a position in the track
     * @param {MouseEvent} e - Click event on progress bar
     */
    seekToPosition(e) {
        const audioElement = this.soundManager.audioElement;
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
        const titleElement = document.getElementById('current-track-title');
        if (titleElement) {
            titleElement.textContent = this.getCurrentSongName();
        }
    }

    /**
     * Updates the playlist active state
     */
    updatePlaylist() {
        const playlistItems = document.querySelectorAll('.playlist-item');
        playlistItems.forEach(item => {
            const trackKey = item.dataset.track;
            if (trackKey === this.currentSong) {
                item.classList.add('active');
                item.querySelector('.playlist-item-icon').innerHTML =
                    '<span class="playing-indicator">♪</span>';
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
        const playPauseBtn = document.getElementById('play-pause');
        if (playPauseBtn) {
            const icon = playPauseBtn.querySelector('.control-icon');
            icon.textContent = isPlaying ? '⏸' : '▶';
            playPauseBtn.title = isPlaying ? 'Pause' : 'Play';
        }
    }

    /**
     * Updates the vinyl disc animation
     * @param {boolean} isPlaying - Whether music is playing
     */
    updateVinylAnimation(isPlaying) {
        const vinylDisc = document.querySelector('.vinyl-disc');
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
    startProgressTracking() {
        // Clear any existing interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        // Update progress every 100ms
        this.updateInterval = setInterval(() => {
            this.updateProgressBar();
        }, 100);
    }

    /**
     * Updates the progress bar and time displays
     */
    updateProgressBar() {
        const audioElement = this.soundManager.audioElement;

        // If no audio element exists, reset to zero
        if (!audioElement) {
            this.resetProgressBar();
            return;
        }

        // Wait for duration to be available (audio is loading)
        if (!audioElement.duration || !isFinite(audioElement.duration)) {
            // Show loading state (only log once per second to avoid spam)
            if (!this.lastLoadingLogTime || Date.now() - this.lastLoadingLogTime > 1000) {
                console.log('[MusicTab] Waiting for audio duration...', audioElement.readyState);
                this.lastLoadingLogTime = Date.now();
            }
            const currentTimeDisplay = document.getElementById('current-time');
            const totalTimeDisplay = document.getElementById('total-time');
            if (currentTimeDisplay && totalTimeDisplay) {
                currentTimeDisplay.textContent = '0:00';
                totalTimeDisplay.textContent = '--:--';
            }
            return;
        }

        const currentTime = audioElement.currentTime;
        const duration = audioElement.duration;
        const percentage = (currentTime / duration) * 100;

        // Update progress bar
        const progressFill = document.getElementById('progress-fill');
        const progressHandle = document.getElementById('progress-handle');
        if (progressFill && progressHandle) {
            progressFill.style.width = `${percentage}%`;
            progressHandle.style.left = `${percentage}%`;
        } else {
            // Log if elements are missing (only once per second)
            if (!this.lastMissingElementsLog || Date.now() - this.lastMissingElementsLog > 1000) {
                console.warn('[MusicTab] Progress elements not found:', {progressFill: !!progressFill, progressHandle: !!progressHandle});
                this.lastMissingElementsLog = Date.now();
            }
        }

        // Update time displays
        const currentTimeDisplay = document.getElementById('current-time');
        const totalTimeDisplay = document.getElementById('total-time');
        if (currentTimeDisplay && totalTimeDisplay) {
            currentTimeDisplay.textContent = this.formatTime(currentTime);
            totalTimeDisplay.textContent = this.formatTime(duration);
        } else {
            // Log if elements are missing (only once per second)
            if (!this.lastMissingTimeLog || Date.now() - this.lastMissingTimeLog > 1000) {
                console.warn('[MusicTab] Time display elements not found:', {currentTimeDisplay: !!currentTimeDisplay, totalTimeDisplay: !!totalTimeDisplay});
                this.lastMissingTimeLog = Date.now();
            }
        }
    }

    /**
     * Resets the progress bar to zero
     */
    resetProgressBar() {
        const progressFill = document.getElementById('progress-fill');
        const progressHandle = document.getElementById('progress-handle');
        if (progressFill && progressHandle) {
            progressFill.style.width = '0%';
            progressHandle.style.left = '0%';
        }

        const currentTimeDisplay = document.getElementById('current-time');
        const totalTimeDisplay = document.getElementById('total-time');
        if (currentTimeDisplay && totalTimeDisplay) {
            currentTimeDisplay.textContent = '0:00';
            totalTimeDisplay.textContent = '0:00';
        }
    }

    /**
     * Formats time in seconds to MM:SS
     * @param {number} seconds - Time in seconds
     * @returns {string} Formatted time string
     */
    formatTime(seconds) {
        if (!isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Gets the current song name
     * @returns {string} Current song display name
     */
    getCurrentSongName() {
        const song = this.songs.find(s => this.nameToKey(s.name) === this.currentSong);
        return song ? song.name : 'No track selected';
    }

    /**
     * Checks if music is currently playing
     * @returns {boolean} True if playing
     */
    isPlaying() {
        const audioElement = this.soundManager.audioElement;
        return audioElement && !audioElement.paused && !this.soundManager.isMuted;
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
        this.trackChangeHandler = (event) => {
            const { trackName } = event.detail;
            if (trackName && trackName !== this.currentSong) {
                console.log('[MusicTab] External track change detected:', trackName);
                this.currentSong = trackName;
                this.updateNowPlaying();
                this.updatePlaylist();

                // Sync play/pause state when track changes
                const audioElement = this.soundManager.audioElement;
                if (audioElement) {
                    const isPlaying = !audioElement.paused;
                    this.updatePlayPauseButton(isPlaying);
                    this.updateVinylAnimation(isPlaying);
                }
            }
        };

        window.addEventListener('musicTrackChanged', this.trackChangeHandler);
        console.log('[MusicTab] Listening for track changes');
    }

    /**
     * Listen for audio element events (play, pause, loadedmetadata)
     */
    listenForAudioEvents() {
        const audioElement = this.soundManager.audioElement;

        if (!audioElement) {
            console.log('[MusicTab] No audio element - will sync on next update');
            return;
        }

        // Play event - sync UI when audio starts playing
        this.audioPlayHandler = () => {
            console.log('[MusicTab] Audio play event detected');
            this.updatePlayPauseButton(true);
            this.updateVinylAnimation(true);
        };

        // Pause event - sync UI when audio pauses
        this.audioPauseHandler = () => {
            console.log('[MusicTab] Audio pause event detected');
            this.updatePlayPauseButton(false);
            this.updateVinylAnimation(false);
        };

        // Loadedmetadata event - sync progress bar when metadata loads
        this.audioLoadedMetadataHandler = () => {
            console.log('[MusicTab] Audio metadata loaded');
            this.updateProgressBar();
        };

        audioElement.addEventListener('play', this.audioPlayHandler);
        audioElement.addEventListener('pause', this.audioPauseHandler);
        audioElement.addEventListener('loadedmetadata', this.audioLoadedMetadataHandler);

        console.log('[MusicTab] Audio event listeners attached');
    }

    /**
     * Syncs the UI state with the actual audio element state
     * Called on initialization to ensure UI matches reality
     */
    syncWithAudioState() {
        const audioElement = this.soundManager.audioElement;

        if (!audioElement) {
            console.log('[MusicTab] No audio element found - UI showing default state');
            this.updatePlayPauseButton(false);
            this.updateVinylAnimation(false);
            this.resetProgressBar();
            return;
        }

        // Sync play/pause state
        const isPlaying = !audioElement.paused;
        console.log('[MusicTab] Syncing with audio state - isPlaying:', isPlaying, 'currentTime:', audioElement.currentTime, 'duration:', audioElement.duration);
        this.updatePlayPauseButton(isPlaying);
        this.updateVinylAnimation(isPlaying);

        // Sync current track
        const currentTrack = this.soundManager.musicTrack;
        if (currentTrack && currentTrack !== this.currentSong) {
            console.log('[MusicTab] Syncing current track:', currentTrack);
            this.currentSong = currentTrack;
            this.updateNowPlaying();
            this.updatePlaylist();
        }

        // Immediately update progress bar
        this.updateProgressBar();
    }

    /**
     * Cleans up the music tab
     */
    destroy() {
        // Clear progress tracking interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }

        // Remove track change listener
        if (this.trackChangeHandler) {
            window.removeEventListener('musicTrackChanged', this.trackChangeHandler);
            this.trackChangeHandler = null;
        }

        // Remove audio element event listeners
        const audioElement = this.soundManager?.audioElement;
        if (audioElement) {
            if (this.audioPlayHandler) {
                audioElement.removeEventListener('play', this.audioPlayHandler);
                this.audioPlayHandler = null;
            }
            if (this.audioPauseHandler) {
                audioElement.removeEventListener('pause', this.audioPauseHandler);
                this.audioPauseHandler = null;
            }
            if (this.audioLoadedMetadataHandler) {
                audioElement.removeEventListener('loadedmetadata', this.audioLoadedMetadataHandler);
                this.audioLoadedMetadataHandler = null;
            }
        }

        console.log('[MusicTab] Destroyed and cleaned up');
    }
}
