/**
 * @fileoverview Sound Manager for Serenity Blocks
 * Manages audio playback, music tracks, and sound effects using Web Audio API
 */

import {
    loadSongs,
    nameToKey,
    getSongPath,
    getSongForTheme,
    getThemeForSong,
} from './music-loader.js';
import { createSoundSets, SoundEffectPlayer } from './sound-effects.js';
import { random } from '../utils/helpers.js';

/**
 * Main sound manager class
 * Handles both procedural music generation and MP3 file playback
 */
export class SoundManager {
    constructor() {
        this.audioContext = null;
        this.isMuted = false;
        this.musicInterval = null;
        this.musicTrack = 'EchoesOfTheSoul';
        this.soundSet = 'Zen';
        this.musicVolume = 1.0;
        this.sfxVolume = 1.0;
        this.currentTrackId = null;
        this.audioElement = null; // HTML5 Audio element for MP3 playback
        this.trackNames = [];
        this.songsData = [];
        this.themeLinkSuspended = false;
        this.pendingThemeLinkedTrack = null;

        // Initialize sound sets (will be populated after init)
        this.soundSets = null;
        this.sfxPlayer = null;

        // References to managers (set after initialization)
        this.settingsManager = null;
        this.themeManager = null;
    }

    /**
     * Initializes the audio context and sound effects
     */
    init() {
        // AudioContext will be created on user gesture
    }

    resumeAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.soundSets = createSoundSets(this.createTone.bind(this));
            this.sfxPlayer = new SoundEffectPlayer(this.soundSets, this.soundSet);
        }
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    /**
     * Creates a tone using Web Audio API
     * @param {number} frequency - Frequency in Hz
     * @param {number} duration - Duration in seconds
     * @param {string} type - Oscillator type ('sine', 'square', 'triangle', 'sawtooth')
     * @param {number} volume - Volume (0-1)
     * @param {Function} onended - Callback when tone ends
     * @param {boolean} isMusic - Whether this is music (affects volume multiplier)
     */
    createTone(
        frequency,
        duration = 0.1,
        type = 'sine',
        volume = 0.3,
        onended = null,
        isMusic = false,
    ) {
        if (!this.audioContext || this.isMuted) return;

        const volumeMultiplier = isMusic ? this.musicVolume : this.sfxVolume;
        const adjustedVolume = volume * volumeMultiplier;
        if (adjustedVolume <= 0) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.connect(gain);
        gain.connect(this.audioContext.destination);

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

        gain.gain.setValueAtTime(adjustedVolume, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + duration);

        osc.start();
        osc.stop(this.audioContext.currentTime + duration);

        if (onended) osc.onended = onended;
    }

    /**
     * Initializes tracks from songs.json
     * @returns {Promise<SoundManager>} Returns this for chaining
     */
    async initializeTracks() {
        const songs = await loadSongs();
        this.songsData = songs;
        this.trackNames = songs.map((song) => nameToKey(song.name));

        // Set default track if current doesn't exist
        if (!this.trackNames.includes(this.musicTrack) && this.trackNames.length > 0) {
            this.musicTrack = this.trackNames[0];
        }

        // Populate the dropdown
        this.populateMusicDropdown();

        return this;
    }

    /**
     * Populates the music track dropdown in the UI
     */
    populateMusicDropdown() {
        const dropdown = document.getElementById('music-track');
        if (!dropdown) return;

        dropdown.innerHTML = '';

        this.songsData.forEach((song) => {
            const option = document.createElement('option');
            option.value = nameToKey(song.name);
            option.textContent = song.name;
            dropdown.appendChild(option);
        });

        dropdown.value = this.musicTrack;
    }

    /**
     * Sets the active music track
     * @param {string} trackName - Track name/key
     */
    setTrack(trackName) {
        if (!this.trackNames.includes(trackName)) return;

        this.pendingThemeLinkedTrack = null;
        this.musicTrack = trackName;

        // Update settings if available
        if (typeof settings !== 'undefined') {
            settings.musicTrack = trackName;
            if (typeof saveSettings === 'function') saveSettings();
        }

        const dropdown = document.getElementById('music-track');
        if (dropdown) dropdown.value = trackName;

        this.stopBackgroundMusic();
        if (!this.isMuted) this.startBackgroundMusic();

        // Apply auto theme change if enabled
        this.applyAutoThemeChange(trackName);

        // Dispatch track change event for UI components to listen
        window.dispatchEvent(new CustomEvent('musicTrackChanged', {
            detail: { trackName }
        }));
    }

    /**
     * Switches to the next track
     */
    nextTrack() {
        const currentIndex = this.trackNames.indexOf(this.musicTrack);
        const nextIndex = (currentIndex + 1) % this.trackNames.length;
        this.setTrack(this.trackNames[nextIndex]);
    }

    /**
     * Switches to the previous track
     */
    previousTrack() {
        const currentIndex = this.trackNames.indexOf(this.musicTrack);
        const prevIndex = (currentIndex - 1 + this.trackNames.length) % this.trackNames.length;
        this.setTrack(this.trackNames[prevIndex]);
    }

    /**
     * Sets the active sound set
     * @param {string} setName - Sound set name ('Retro', 'Zen', 'Pulse', or 'Nebula')
     */
    setSoundSet(setName) {
        this.soundSet = setName;
        if (this.sfxPlayer) {
            this.sfxPlayer.setSoundSet(setName);
        }
    }

    /**
     * Applies theme-linked music if enabled
     * @param {string} themeName - Theme name
     */
    applyThemeLinkedMusic(themeName) {
        if (!this.settingsManager) return;

        const settings = this.settingsManager.get();
        if (!settings.themeLinkedMode) return;

        const linkedSong = getSongForTheme(themeName, this.songsData);
        if (linkedSong) {
            if (this.themeLinkSuspended) {
                console.log(`🎵 Theme-linked music deferred (suspended): ${themeName} → ${linkedSong}`);
                this.pendingThemeLinkedTrack = linkedSong;
                return;
            }
            console.log(`🎵 Theme-linked: ${themeName} → ${linkedSong}`);
            this.setTrack(linkedSong);
        } else {
            console.log(`🎵 No theme match for ${themeName}, continuing current track`);
            this.pendingThemeLinkedTrack = null;
        }
    }

    /**
     * Applies auto theme change if enabled
     * @param {string} trackName - Track name/key
     */
    applyAutoThemeChange(trackName) {
        if (!this.settingsManager || !this.themeManager) return;

        const settings = this.settingsManager.get();
        if (!settings.autoThemeChange || !settings.themeLinkedMode) return;

        // Import THEMES from constants
        import('../core/constants.js').then(({ THEMES }) => {
            const linkedTheme = getThemeForSong(trackName, THEMES);
            if (linkedTheme) {
                console.log(`🎨 Auto theme change: ${trackName} → ${linkedTheme}`);

                // Switch theme using theme manager
                if (this.themeManager) {
                    this.themeManager.switchTheme(linkedTheme);
                }

                // Update settings
                this.settingsManager.update({ backgroundTheme: linkedTheme });
                const bgSelect = document.getElementById('background-theme');
                if (bgSelect) bgSelect.value = linkedTheme;
                this.settingsManager.save();
            } else {
                console.log(`🎨 No theme match for ${trackName}`);
            }
        });
    }

    // ==================== Sound Effect Wrappers ====================

    playMove() {
        if (this.sfxPlayer) this.sfxPlayer.playMove();
    }

    playRotate() {
        if (this.sfxPlayer) this.sfxPlayer.playRotate();
    }

    playDrop() {
        if (this.sfxPlayer) this.sfxPlayer.playDrop();
    }

    playLineClear() {
        if (this.sfxPlayer) this.sfxPlayer.playLineClear();
    }

    playLevelUp() {
        if (this.sfxPlayer) this.sfxPlayer.playLevelUp();
    }

    playGameOver() {
        if (this.sfxPlayer) this.sfxPlayer.playGameOver();
    }
    
    /**
     * PHASE 3.4: Play garbage received sound
     */
    playGarbageReceived() {
        if (this.sfxPlayer) this.sfxPlayer.playGarbageReceived();
    }
    
    /**
     * PHASE 3.4: Play garbage countered sound
     */
    playGarbageCountered() {
        if (this.sfxPlayer) this.sfxPlayer.playGarbageCountered();
    }
    
    /**
     * PHASE 3.4: Play player death sound
     */
    playPlayerDeath() {
        if (this.sfxPlayer) this.sfxPlayer.playPlayerDeath();
    }
    
    /**
     * Play garbage send sound (already exists in sound sets)
     */
    playGarbageSend() {
        if (this.sfxPlayer) this.sfxPlayer.playGarbageSend();
    }

    // ==================== Music Playback ====================

    /**
     * Starts background music (MP3 file from songs folder)
     */
    startBackgroundMusic() {
        if (this.isMuted) return;
        this.stopBackgroundMusic();
        this.currentTrackId = Symbol();

        const songPath = getSongPath(this.musicTrack, this.songsData);
        this.playAudioFile(songPath);
    }

    /**
     * Plays an MP3 audio file
     * @param {string} filename - Path to the audio file
     */
    playAudioFile(filename) {
        // Stop any existing music first
        this.stopBackgroundMusic();

        // Create or reuse audio element
        if (!this.audioElement) {
            this.audioElement = new Audio();
            // Add event listener for automatic song progression
            this.audioElement.addEventListener('ended', () => {
                this.nextTrack();
            });
        }

        // Set the source and configure
        this.audioElement.src = filename;
        this.audioElement.volume = this.musicVolume;
        this.audioElement.muted = this.isMuted;
        this.audioElement.loop = false; // Disable loop to enable automatic progression

        // Play the audio (handle autoplay restrictions)
        const playPromise = this.audioElement.play();
        if (playPromise !== undefined) {
            playPromise.catch((error) => {
                console.log('Audio playback prevented:', error);
            });
        }
    }

    /**
     * Stops all background music
     */
    stopBackgroundMusic() {
        this.currentTrackId = null;

        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }

        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.currentTime = 0;
        }
    }

    /**
     * Toggles mute state
     * @returns {boolean} New mute state
     */
    toggleMute() {
        this.isMuted = !this.isMuted;

        if (this.audioElement) {
            this.audioElement.muted = this.isMuted;
        }

        this.isMuted ? this.stopBackgroundMusic() : this.startBackgroundMusic();
        return this.isMuted;
    }

    setMusicVolume(volume) {
        this.musicVolume = volume;
        if (this.audioElement) {
            this.audioElement.volume = this.musicVolume;
        }
    }

    setSFXVolume(volume) {
        this.sfxVolume = volume;
    }

    /**
     * Temporarily suspend automatic theme-linked music switching
     */
    suspendThemeLinkedMusic() {
        this.themeLinkSuspended = true;
    }

    /**
     * Resume theme-linked music switching
     * @param {boolean} applyPending - Whether to apply any deferred track change
     */
    resumeThemeLinkedMusic(applyPending = true) {
        this.themeLinkSuspended = false;
        if (applyPending && this.pendingThemeLinkedTrack) {
            const pendingTrack = this.pendingThemeLinkedTrack;
            this.pendingThemeLinkedTrack = null;
            this.setTrack(pendingTrack);
        } else {
            this.pendingThemeLinkedTrack = null;
        }
    }

    /**
     * Checks if background music is currently playing
     * @returns {boolean} True if an audio element is actively playing
     */
    isMusicPlaying() {
        if (!this.audioElement) {
            return false;
        }
        return !this.audioElement.paused && !this.audioElement.ended;
    }

    // ==================== Procedural Music Generators ====================
    // Note: These are legacy methods kept for compatibility with older themes
    // Most music now comes from MP3 files loaded via playAudioFile

    startGongBathMusic(trackId) {
        const baseNotes = [41.2, 48.99, 55.0, 61.74]; // E1, G1, A1, B1

        const playGong = () => {
            if (this.isMuted || trackId !== this.currentTrackId) return;

            const baseFreq = baseNotes[~~(Math.random() * baseNotes.length)];
            const duration = random(15, 20);
            const mainVolume = random(0.1, 0.2);

            this.createTone(baseFreq, duration, 'sine', mainVolume, null, true);
            this.createTone(baseFreq / 2, duration * 1.1, 'sine', mainVolume * 0.6, null, true);

            for (let i = 2; i < 9; i++) {
                if (Math.random() > 0.65) {
                    const overtoneFreq = baseFreq * (i + random(-0.1, 0.1));
                    const overtoneVolume = (mainVolume / (i * 2)) * random(0.5, 1.0);
                    const overtoneDuration = duration * random(0.7, 1.1);
                    setTimeout(
                        () => {
                            if (this.isMuted || trackId !== this.currentTrackId) return;
                            this.createTone(
                                overtoneFreq,
                                overtoneDuration,
                                'sine',
                                overtoneVolume,
                                null,
                                true,
                            );
                        },
                        random(100, 400),
                    );
                }
            }

            const nextGongIn = random(10000, 18000);
            setTimeout(playGong, nextGongIn);
        };

        playGong();
    }

    startAmbientMusic(trackId) {
        const scale = [261, 311, 349, 392, 466];
        const drone = 130;

        const interval = setInterval(() => {
            if (this.isMuted || trackId !== this.currentTrackId) {
                clearInterval(interval);
                return;
            }
            this.createTone(scale[~~(Math.random() * scale.length)], 0.8, 'sine', 0.15, null, true);
            if (Math.random() > 0.7) {
                this.createTone(
                    scale[~~(Math.random() * scale.length)] / 2,
                    1.2,
                    'sine',
                    0.1,
                    null,
                    true,
                );
            }
            if (Math.random() > 0.9) {
                this.createTone(drone, 2.5, 'sine', 0.08, null, true);
            }
        }, 900);

        this.musicInterval = interval;
    }

    startZenMusic(trackId) {
        const scale = [261.63, 392.0, 440.0, 523.25];
        const drone = 110;

        const interval = setInterval(() => {
            if (this.isMuted || trackId !== this.currentTrackId) {
                clearInterval(interval);
                return;
            }
            if (Math.random() > 0.8) {
                this.createTone(drone, 10, 'sine', 0.05, null, true);
            }
            if (Math.random() > 0.7) {
                this.createTone(
                    scale[~~(Math.random() * scale.length)],
                    3,
                    'sine',
                    0.1,
                    null,
                    true,
                );
            }
        }, 4000);

        this.musicInterval = interval;
    }

    // Additional legacy music generators can be added here as needed
    // For brevity, including just a few examples above
}
