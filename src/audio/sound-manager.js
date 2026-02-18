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
        this.playPromise = null; // Track pending play promise to avoid AbortError
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
            this.soundSets = createSoundSets(this.createTone.bind(this), this.createRichTone.bind(this));
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
     * Creates a rich, layered tone with multiple oscillators, noise, and filtering
     * @param {Object} params - Sound parameters
     */
    createRichTone({
        oscillators = [], // Array of { type, freq, detune, gain, delay }
        noise = null, // { type: 'white'|'pink', gain }
        envelope = {
            attack: 0.01, decay: 0.1, sustain: 0, release: 0.1,
        },
        filter = null, // { type, frequency, Q, envAmount }
        duration = 0.2,
        volume = 1.0,
        isMusic = false,
    }) {
        if (!this.audioContext || this.isMuted) return;

        const volumeMultiplier = isMusic ? this.musicVolume : this.sfxVolume;
        const masterGainValue = volume * volumeMultiplier;
        if (masterGainValue <= 0) return;

        const now = this.audioContext.currentTime;
        const masterGain = this.audioContext.createGain();
        masterGain.connect(this.audioContext.destination);

        // Master Envelope
        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(masterGainValue, now + envelope.attack);
        masterGain.gain.exponentialRampToValueAtTime(
            Math.max(0.001, masterGainValue * (envelope.sustain || 0)),
            now + envelope.attack + envelope.decay,
        );

        const releaseStart = now + duration;
        if (envelope.release) {
            masterGain.gain.exponentialRampToValueAtTime(0.001, releaseStart + envelope.release);
        } else {
            masterGain.gain.exponentialRampToValueAtTime(0.001, releaseStart + 0.01);
        }

        // Filter
        let destination = masterGain;
        if (filter) {
            const biquadFilter = this.audioContext.createBiquadFilter();
            biquadFilter.type = filter.type || 'lowpass';
            biquadFilter.Q.value = filter.Q || 1;
            biquadFilter.frequency.setValueAtTime(filter.frequency || 1000, now);

            if (filter.envAmount) {
                biquadFilter.frequency.linearRampToValueAtTime(
                    (filter.frequency || 1000) + filter.envAmount,
                    now + envelope.attack,
                );
                biquadFilter.frequency.exponentialRampToValueAtTime(
                    filter.frequency || 1000,
                    now + envelope.attack + envelope.decay,
                );
            }

            biquadFilter.connect(masterGain);
            destination = biquadFilter;
        }

        // Oscillators
        oscillators.forEach((oscDef) => {
            const osc = this.audioContext.createOscillator();
            const oscGain = this.audioContext.createGain();

            osc.type = oscDef.type || 'sine';
            osc.frequency.value = oscDef.freq || 440;
            if (oscDef.detune) osc.detune.value = oscDef.detune;

            oscGain.gain.value = oscDef.gain !== undefined ? oscDef.gain : 1;

            osc.connect(oscGain);
            oscGain.connect(destination);

            const startTime = now + (oscDef.delay || 0);
            osc.start(startTime);
            osc.stop(releaseStart + (envelope.release || 0));
        });

        // Noise
        if (noise) {
            const totalDuration = duration + (envelope.release || 0);
            const bufferSize = this.audioContext.sampleRate * totalDuration;
            const buffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
            const data = buffer.getChannelData(0);

            if (noise.type === 'pink') {
                // Pink noise approximation
                let b0; let b1; let b2; let b3; let b4; let b5; let
                    b6;
                b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;
                for (let i = 0; i < bufferSize; i++) {
                    const white = Math.random() * 2 - 1;
                    b0 = 0.99886 * b0 + white * 0.0555179;
                    b1 = 0.99332 * b1 + white * 0.0750759;
                    b2 = 0.96900 * b2 + white * 0.1538520;
                    b3 = 0.86650 * b3 + white * 0.3104856;
                    b4 = 0.55000 * b4 + white * 0.5329522;
                    b5 = -0.7616 * b5 - white * 0.0168980;
                    data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
                    data[i] *= 0.11;
                    b6 = white * 0.115926;
                }
            } else {
                // White noise
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
            }

            const noiseSource = this.audioContext.createBufferSource();
            noiseSource.buffer = buffer;
            const noiseGain = this.audioContext.createGain();
            noiseGain.gain.value = noise.gain || 0.1;

            noiseSource.connect(noiseGain);
            noiseGain.connect(destination);
            noiseSource.start(now);
        }
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

        // Prevent restarting if already playing this track
        if (this.musicTrack === trackName && this.currentTrackId) {
            return;
        }

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
            detail: { trackName },
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
        const songPath = getSongPath(this.musicTrack, this.songsData);
        this.playAudioFile(songPath);
        this.currentTrackId = Symbol();
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
        this.playPromise = this.audioElement.play();
        if (this.playPromise !== undefined) {
            this.playPromise
                .catch((error) => {
                    // Only log non-abort errors (abort is expected when switching tracks)
                    if (error.name !== 'AbortError') {
                        console.log('Audio playback prevented:', error);
                    }
                })
                .finally(() => {
                    this.playPromise = null;
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
            // Wait for any pending play promise before pausing to avoid AbortError
            const doPause = () => {
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
            };

            if (this.playPromise) {
                this.playPromise.then(doPause).catch(doPause);
                this.playPromise = null;
            } else {
                doPause();
            }
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
