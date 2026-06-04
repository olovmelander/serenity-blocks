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
import { AudioAnalyzer } from './audio-analyzer.js';
import { random } from '../utils/helpers.js';

function clampUnitVolume(value, fallback = 1.0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return Math.max(0, Math.min(1, fallback));
    }
    return Math.max(0, Math.min(1, numeric));
}

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
        this.pendingTrackKey = null;
        this.lastRequestedTrackKey = null;
        this.lastAppliedTrackKey = null;
        this.trackRequestToken = 0;
        this.audioAnalyzer = null;
        this.analysisUpdateIntervalMs = 33;
        this.hiddenAnalysisUpdateIntervalMs = 200;
        this.lastAudioAnalysisAtMs = 0;
        this.trackSwitchPromise = Promise.resolve();
        this.trackFadeOutMs = 2500;
        this.trackFadeInMs = 2000;
        this.volumeFadeFrame = null;
        this.volumeFadeToken = 0;
        this.musicGainNode = null;
        this.musicGainWired = false;
        this.sfxBusNode = null;
        this.sfxLimiterNode = null;
        this.preloadAudioElement = null;
        this.preloadedTrackKey = null;
        this.lastAnalyzerBootstrapAtMs = 0;
        this.analyzerBootstrapCooldownMs = 800;
        this.lastAnalyzerBootstrapError = null;
        this.lastAudioAnalysis = {
            bassEnergy: 0,
            midEnergy: 0,
            trebleEnergy: 0,
            overallEnergy: 0,
            beatDetected: false,
        };

        // Initialize sound sets (will be populated after init)
        this.soundSets = null;
        this.sfxPlayer = null;
        this.onAudioEnded = () => {
            this.nextTrack();
        };
        this.handleVisibilityChange = () => {
            if (document.hidden) {
                this.lastAudioAnalysisAtMs = 0;
            } else {
                this.resumeAudioContext();
            }
        };
        this.handleAudioDeviceChange = () => {
            console.log('[SoundManager] Audio device change detected; rebuilding analysis pipeline');
            this.disposeAudioAnalysis();
            if (this.isMusicPlaying()) {
                this.ensureAudioAnalysisReady({ force: true });
            }
        };
        this.runtimeHooksBound = false;

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
            this.musicGainNode = this.audioContext.createGain();
            this.musicGainNode.gain.value = this.getMusicVolume();
            this.ensureSfxBus();
            this.soundSets = createSoundSets(this.createTone.bind(this), this.createRichTone.bind(this));
            this.sfxPlayer = new SoundEffectPlayer(this.soundSets, this.soundSet);
        }
        this.bindRuntimeAudioHooks();
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
    }

    ensureSfxBus() {
        if (!this.audioContext) return null;
        if (this.sfxBusNode && this.sfxLimiterNode) {
            return this.sfxBusNode;
        }

        const sfxBus = this.audioContext.createGain();
        sfxBus.gain.value = 1.0;

        const limiter = this.audioContext.createDynamicsCompressor();
        limiter.threshold.value = -8;
        limiter.knee.value = 0;
        limiter.ratio.value = 12;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.08;

        sfxBus.connect(limiter);
        limiter.connect(this.audioContext.destination);

        this.sfxBusNode = sfxBus;
        this.sfxLimiterNode = limiter;
        return this.sfxBusNode;
    }

    getToneDestination(isMusic = false) {
        if (!this.audioContext) return null;
        if (isMusic) {
            return this.audioContext.destination;
        }
        return this.ensureSfxBus() || this.audioContext.destination;
    }

    disposeSfxBus() {
        if (this.sfxBusNode) {
            try {
                this.sfxBusNode.disconnect();
            } catch {
                // Already disconnected.
            }
        }
        if (this.sfxLimiterNode) {
            try {
                this.sfxLimiterNode.disconnect();
            } catch {
                // Already disconnected.
            }
        }
        this.sfxBusNode = null;
        this.sfxLimiterNode = null;
    }

    bindRuntimeAudioHooks() {
        if (this.runtimeHooksBound || typeof document === 'undefined') {
            return;
        }

        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', this.handleAudioDeviceChange);
        }

        this.runtimeHooksBound = true;
    }

    unbindRuntimeAudioHooks() {
        if (!this.runtimeHooksBound || typeof document === 'undefined') {
            return;
        }

        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.removeEventListener) {
            navigator.mediaDevices.removeEventListener('devicechange', this.handleAudioDeviceChange);
        }

        this.runtimeHooksBound = false;
    }

    disposeAudioAnalysis() {
        if (this.audioAnalyzer?.dispose) {
            try {
                this.audioAnalyzer.dispose();
            } catch (error) {
                console.warn('[SoundManager] Failed to dispose audio analyzer:', error);
            }
        }
        this.audioAnalyzer = null;
        this.musicGainWired = false;
        this.lastAudioAnalysis = {
            bassEnergy: 0,
            midEnergy: 0,
            trebleEnergy: 0,
            overallEnergy: 0,
            beatDetected: false,
        };
        this.lastAnalyzerBootstrapError = null;
    }

    ensureAudioAnalysisReady({ force = false } = {}) {
        if (typeof performance !== 'undefined' && performance.now) {
            const nowMs = performance.now();
            if (!force && nowMs - this.lastAnalyzerBootstrapAtMs < this.analyzerBootstrapCooldownMs) {
                return this.audioAnalyzer;
            }
            this.lastAnalyzerBootstrapAtMs = nowMs;
        }

        if (!this.audioElement) {
            return null;
        }

        try {
            if (!this.audioContext) {
                this.resumeAudioContext();
            }
        } catch (error) {
            const message = error?.message || String(error);
            if (this.lastAnalyzerBootstrapError !== message) {
                console.warn('[SoundManager] Unable to initialize audio context for analyzer:', message);
                this.lastAnalyzerBootstrapError = message;
            }
            return this.audioAnalyzer;
        }

        if (this.audioContext?.state === 'suspended') {
            this.audioContext.resume().catch((error) => {
                const message = error?.message || String(error);
                if (this.lastAnalyzerBootstrapError !== message) {
                    console.warn('[SoundManager] Unable to resume audio context for analyzer:', message);
                    this.lastAnalyzerBootstrapError = message;
                }
            });
        }

        if (!this.audioAnalyzer && this.audioContext && this.audioElement) {
            try {
                this.audioAnalyzer = new AudioAnalyzer(this.audioContext, this.audioElement);
                this.lastAnalyzerBootstrapError = null;

                // Insert musicGainNode between analyser and destination for sample-accurate volume control.
                // AudioAnalyzer wires: source -> analyser -> destination
                // We rewire to:        source -> analyser -> musicGainNode -> destination
                if (this.musicGainNode && !this.musicGainWired && this.audioAnalyzer.analyserNode) {
                    try {
                        this.audioAnalyzer.analyserNode.disconnect(this.audioContext.destination);
                        this.audioAnalyzer.analyserNode.connect(this.musicGainNode);
                        this.musicGainNode.connect(this.audioContext.destination);
                        this.musicGainWired = true;
                    } catch (e) {
                        console.warn('[SoundManager] Could not wire musicGainNode:', e.message);
                    }
                }
            } catch (error) {
                const message = error?.message || String(error);
                if (this.lastAnalyzerBootstrapError !== message) {
                    console.warn('[SoundManager] Audio analyzer unavailable:', message);
                    this.lastAnalyzerBootstrapError = message;
                }
                this.audioAnalyzer = null;
            }
        }

        return this.audioAnalyzer;
    }

    /**
     * Returns shared analyzer instance for themes/visual systems.
     * This centralizes MediaElementSource ownership and avoids duplicate-node errors.
     */
    getAnalyzer(createIfMissing = true) {
        if (this.audioAnalyzer) {
            return this.audioAnalyzer;
        }

        if (!createIfMissing) {
            return null;
        }

        return this.ensureAudioAnalysisReady({ force: true });
    }

    hasAudioAnalyzer() {
        return Boolean(this.audioAnalyzer);
    }

    /**
     * Updates and returns the latest audio analysis snapshot.
     * Safe to call every frame from any theme.
     */
    getAudioAnalysis(deltaTime = 1 / 60) {
        const nowMs = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        const isHidden = typeof document !== 'undefined' ? document.hidden : false;
        const minInterval = isHidden
            ? this.hiddenAnalysisUpdateIntervalMs
            : this.analysisUpdateIntervalMs;
        if (this.lastAudioAnalysisAtMs && nowMs - this.lastAudioAnalysisAtMs < minInterval) {
            return this.lastAudioAnalysis;
        }

        let analyzer = this.getAnalyzer(false);
        if (!analyzer && this.isMusicPlaying()) {
            analyzer = this.ensureAudioAnalysisReady();
        }

        if (!analyzer) {
            this.lastAudioAnalysis = {
                bassEnergy: 0,
                midEnergy: 0,
                trebleEnergy: 0,
                overallEnergy: 0,
                beatDetected: false,
            };
            return this.lastAudioAnalysis;
        }

        const snapshot = analyzer.update(deltaTime);
        this.lastAudioAnalysisAtMs = nowMs;
        this.lastAudioAnalysis = {
            bassEnergy: snapshot.bassEnergy,
            midEnergy: snapshot.midEnergy,
            trebleEnergy: snapshot.trebleEnergy,
            overallEnergy: snapshot.overallEnergy,
            beatDetected: snapshot.beatDetected,
        };
        return this.lastAudioAnalysis;
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

        const volumeMultiplier = isMusic ? this.getMusicVolume() : this.getSfxVolume();
        const adjustedVolume = volume * volumeMultiplier;
        if (adjustedVolume <= 0) return;

        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const destination = this.getToneDestination(isMusic);

        osc.connect(gain);
        gain.connect(destination);

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

        const volumeMultiplier = isMusic ? this.getMusicVolume() : this.getSfxVolume();
        const masterGainValue = volume * volumeMultiplier;
        if (masterGainValue <= 0) return;

        const now = this.audioContext.currentTime;
        const masterGain = this.audioContext.createGain();
        masterGain.connect(this.getToneDestination(isMusic));

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
                let b0 = 0.0;
                let b1 = 0.0;
                let b2 = 0.0;
                let b3 = 0.0;
                let b4 = 0.0;
                let b5 = 0.0;
                let b6 = 0.0;
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
        this.preloadDefaultTrack();

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

    normalizeAudioUrl(url) {
        if (!url) return null;
        try {
            return new URL(url, window.location.href).href;
        } catch {
            return String(url);
        }
    }

    resolveTrackUrl(trackKey) {
        if (!trackKey) return null;
        const songPath = getSongPath(trackKey, this.songsData);
        if (!songPath) return null;
        return this.normalizeAudioUrl(songPath);
    }

    shouldPreloadMusicTrack() {
        if (typeof window === 'undefined' || typeof Audio === 'undefined') {
            return false;
        }

        if (window.electronAPI || window.electronDisplay) {
            return false;
        }

        return window.location?.protocol !== 'file:';
    }

    preloadDefaultTrack() {
        if (!this.shouldPreloadMusicTrack()) {
            return;
        }

        const trackUrl = this.resolveTrackUrl(this.musicTrack);
        if (!trackUrl || this.preloadedTrackKey === this.musicTrack) {
            return;
        }

        if (this.preloadAudioElement) {
            this.preloadAudioElement.src = '';
            this.preloadAudioElement = null;
        }

        this.preloadAudioElement = new Audio();
        this.preloadAudioElement.preload = 'auto';
        this.preloadAudioElement.src = trackUrl;
        this.preloadAudioElement.load();
        this.preloadedTrackKey = this.musicTrack;
    }

    resolveTrackKeyFromUrl(url) {
        const normalizedUrl = this.normalizeAudioUrl(url);
        if (!normalizedUrl) return null;

        for (const trackKey of this.trackNames) {
            const trackUrl = this.resolveTrackUrl(trackKey);
            if (trackUrl && trackUrl === normalizedUrl) {
                return trackKey;
            }
        }

        return null;
    }

    getActualTrackKey() {
        if (!this.audioElement) return null;
        const currentSrc = this.audioElement.currentSrc || this.audioElement.src;
        return this.resolveTrackKeyFromUrl(currentSrc);
    }

    isTrackActuallyPlaying(trackKey) {
        if (!trackKey || !this.audioElement) return false;
        const actualTrack = this.getActualTrackKey();
        return actualTrack === trackKey && !this.audioElement.paused && !this.audioElement.ended;
    }

    async ensureTrackPlaybackSynced(options = {}) {
        const { reason = 'manual-sync', force = false } = options;
        const selectedTrack = this.musicTrack;

        if (!selectedTrack || !this.trackNames.includes(selectedTrack)) {
            return;
        }

        let actualTrack = this.getActualTrackKey();
        let isPlaying = this.isMusicPlaying();
        const isPendingSelectedTrack = this.pendingTrackKey === selectedTrack;

        this.lastRequestedTrackKey = selectedTrack;

        if (isPendingSelectedTrack) {
            await this.trackSwitchPromise.catch(() => { });

            actualTrack = this.getActualTrackKey();
            isPlaying = this.isMusicPlaying();

            const isStillMismatched = actualTrack !== selectedTrack || (!this.isMuted && !isPlaying);
            if (!isStillMismatched) {
                return;
            }
        }

        const hasMismatch = actualTrack !== selectedTrack || (!this.isMuted && !isPlaying);
        if (!hasMismatch) {
            return;
        }

        if (this.isMuted) {
            return;
        }

        const targetUrl = this.resolveTrackUrl(selectedTrack);
        if (!targetUrl) {
            return;
        }

        await this.playAudioFile(targetUrl, {
            trackKey: selectedTrack,
            reason,
            forceSwitch: force && actualTrack !== selectedTrack,
        });
    }

    emitMusicPlaybackError(detail = {}) {
        if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
            return;
        }

        window.dispatchEvent(new CustomEvent('musicPlaybackError', {
            detail,
        }));
    }

    createSupersededRequestError() {
        const error = new Error('Track switch superseded by a newer request');
        error.name = 'AbortError';
        return error;
    }

    assertTrackRequestIsCurrent(requestToken) {
        if (requestToken !== this.trackRequestToken) {
            throw this.createSupersededRequestError();
        }
    }

    async performTrackSwitch({
        filename,
        trackKey,
        requestToken,
        useFade = true,
        forceSwitch = false,
    }) {
        this.assertTrackRequestIsCurrent(requestToken);

        if (!this.audioElement) {
            this.audioElement = new Audio();
            this.audioElement.addEventListener('ended', this.onAudioEnded);
        }

        const requestedUrl = this.normalizeAudioUrl(filename);
        const currentUrl = this.normalizeAudioUrl(this.audioElement.currentSrc || this.audioElement.src);
        const isSameSource = Boolean(requestedUrl) && requestedUrl === currentUrl;
        const isPlaying = !this.audioElement.paused && !this.audioElement.ended;

        if (!forceSwitch && isSameSource && isPlaying) {
            this.audioElement.muted = this.isMuted;
            this.audioElement.loop = false;
            if (!this.isMuted) {
                this.setAudioElementVolume(this.getMusicVolume());
            }
            this.lastAppliedTrackKey = this.getActualTrackKey() || trackKey || null;
            return;
        }

        const isSourceSwitch = !isSameSource;

        // Preload new audio source during fade-out to eliminate the silence gap.
        // The browser caches the fetched data so the subsequent src swap is instant.
        let preloadElement = null;
        if (isSourceSwitch) {
            preloadElement = new Audio();
            preloadElement.preload = 'auto';
            preloadElement.src = filename;
            preloadElement.load();
        }

        if (useFade && isSourceSwitch && isPlaying && !this.isMuted) {
            await this.fadeMusicVolume(0, this.trackFadeOutMs);
        } else {
            this.cancelMusicVolumeFade();
        }

        this.assertTrackRequestIsCurrent(requestToken);
        await this.pauseAudioElement(true);
        this.assertTrackRequestIsCurrent(requestToken);

        if (isSourceSwitch) {
            this.audioElement.src = filename;
        }

        // Clean up preload element (browser keeps data cached)
        if (preloadElement) {
            preloadElement.src = '';
            preloadElement = null;
        }

        const shouldFadeIn = useFade && isSourceSwitch && !this.isMuted;
        this.setAudioElementVolume(shouldFadeIn ? 0 : this.getMusicVolume());
        this.audioElement.muted = this.isMuted;
        this.audioElement.loop = false;

        this.ensureAudioAnalysisReady({ force: true });

        this.playPromise = this.audioElement.play();
        if (this.playPromise !== undefined) {
            await this.playPromise;
        }

        this.assertTrackRequestIsCurrent(requestToken);

        if (shouldFadeIn) {
            await this.fadeMusicVolume(this.getMusicVolume(), this.trackFadeInMs);
        }

        this.lastAppliedTrackKey = this.getActualTrackKey() || trackKey || null;
    }

    /**
     * Sets the active music track
     * @param {string} trackName - Track name/key
     */
    setTrack(trackName) {
        if (!this.trackNames.includes(trackName)) return;
        const previousTrack = this.musicTrack;
        const didSelectionChange = previousTrack !== trackName;
        const hasPendingSameRequest = this.pendingTrackKey === trackName;
        const isAlreadyAudible = this.isTrackActuallyPlaying(trackName);

        this.pendingThemeLinkedTrack = null;
        this.musicTrack = trackName;
        this.lastRequestedTrackKey = trackName;

        // Update settings if available
        const globalSettings = globalThis.settings;
        const globalSaveSettings = globalThis.saveSettings;
        if (didSelectionChange && globalSettings) {
            globalSettings.musicTrack = trackName;
            if (typeof globalSaveSettings === 'function') globalSaveSettings();
        }

        const dropdown = document.getElementById('music-track');
        if (dropdown) dropdown.value = trackName;

        if (!this.isMuted && !isAlreadyAudible && !hasPendingSameRequest) {
            this.startBackgroundMusic({ trackKey: trackName, reason: 'set-track' });
        }

        // Apply auto theme change if enabled
        if (didSelectionChange) {
            this.applyAutoThemeChange(trackName);
        }

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

        const sharedThemeLinkedTracks = new Set(['ElectricDreams']);
        if (sharedThemeLinkedTracks.has(trackName)) {
            return;
        }

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

    cancelMusicVolumeFade() {
        this.volumeFadeToken += 1;
        if (this.volumeFadeFrame !== null) {
            // Web Audio path uses setTimeout; rAF path uses requestAnimationFrame.
            // Both accept numeric IDs safely, so call both to cover either case.
            clearTimeout(this.volumeFadeFrame);
            cancelAnimationFrame(this.volumeFadeFrame);
            this.volumeFadeFrame = null;
        }
        // Cancel any in-progress Web Audio gain ramps
        if (this.musicGainNode && this.musicGainWired && this.audioContext) {
            this.musicGainNode.gain.cancelScheduledValues(this.audioContext.currentTime);
        }
    }

    getMusicVolume() {
        this.musicVolume = clampUnitVolume(this.musicVolume, 1.0);
        return this.musicVolume;
    }

    getSfxVolume() {
        this.sfxVolume = clampUnitVolume(this.sfxVolume, 1.0);
        return this.sfxVolume;
    }

    setAudioElementVolume(value) {
        const clamped = clampUnitVolume(value, 1.0);
        if (this.musicGainNode && this.musicGainWired) {
            // Use Web Audio gain node — sample-accurate, no clicks
            this.musicGainNode.gain.value = clamped;
            // Keep audioElement.volume at 1 so the gain node has full dynamic range
            if (this.audioElement) this.audioElement.volume = 1.0;
        } else if (this.audioElement) {
            this.audioElement.volume = clamped;
        }
    }

    _getCurrentMusicVolume() {
        if (this.musicGainNode && this.musicGainWired) {
            return this.musicGainNode.gain.value;
        }
        return this.audioElement ? this.audioElement.volume : 0;
    }

    fadeMusicVolume(targetVolume, durationMs = 0) {
        if (!this.audioElement) {
            return Promise.resolve();
        }

        const clampedTarget = Math.max(0, Math.min(1, targetVolume));
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            this.setAudioElementVolume(clampedTarget);
            return Promise.resolve();
        }

        this.cancelMusicVolumeFade();
        const token = this.volumeFadeToken;
        const startVolume = this._getCurrentMusicVolume();

        if (Math.abs(startVolume - clampedTarget) < 0.001) {
            this.setAudioElementVolume(clampedTarget);
            return Promise.resolve();
        }

        // Prefer Web Audio API scheduling for sample-accurate, click-free fading
        if (this.musicGainNode && this.musicGainWired && this.audioContext) {
            const gain = this.musicGainNode.gain;
            const now = this.audioContext.currentTime;
            gain.cancelScheduledValues(now);

            // Web Audio API exponentialRampToValueAtTime cannot start from or target exactly 0.
            // If startVolume is 0, it causes a severe click/pop. Safe floor is 0.0001.
            const safeStart = Math.max(startVolume, 0.0001);
            const safeTarget = Math.max(clampedTarget, 0.0001);

            gain.setValueAtTime(safeStart, now);
            // Use exponentialRamp for perceptual smoothness (human hearing is logarithmic).
            gain.exponentialRampToValueAtTime(safeTarget, now + durationMs / 1000);

            // Keep audioElement.volume at 1 so gain node controls everything
            this.audioElement.volume = 1.0;

            return new Promise((resolve) => {
                const checkInterval = setTimeout(() => {
                    // Snap to exact target when done
                    if (token === this.volumeFadeToken) {
                        gain.cancelScheduledValues(this.audioContext.currentTime);
                        gain.value = clampedTarget;
                    }
                    resolve();
                }, durationMs + 50);
                // Store so cancelMusicVolumeFade can clear it
                this.volumeFadeFrame = checkInterval;
            });
        }

        // Fallback: requestAnimationFrame with ease-out curve
        const startTime = performance.now();
        return new Promise((resolve) => {
            const tick = (now) => {
                if (token !== this.volumeFadeToken) {
                    resolve();
                    return;
                }
                if (!this.audioElement) {
                    this.volumeFadeFrame = null;
                    resolve();
                    return;
                }

                const progress = Math.min(1, (now - startTime) / durationMs);
                const eased = 1 - Math.pow(1 - progress, 2);
                this.setAudioElementVolume(startVolume + ((clampedTarget - startVolume) * eased));

                if (progress >= 1) {
                    this.volumeFadeFrame = null;
                    this.setAudioElementVolume(clampedTarget);
                    resolve();
                    return;
                }

                this.volumeFadeFrame = requestAnimationFrame(tick);
            };

            this.volumeFadeFrame = requestAnimationFrame(tick);
        });
    }

    async pauseAudioElement(resetPosition = true) {
        if (!this.audioElement) return;

        if (this.playPromise) {
            try {
                await this.playPromise;
            } catch {
                // Ignore aborted play() during rapid switches.
            } finally {
                this.playPromise = null;
            }
        }

        this.audioElement.pause();
        if (resetPosition) {
            this.audioElement.currentTime = 0;
        }
    }

    // ==================== Music Playback ====================

    /**
     * Starts background music (MP3 file from songs folder)
     */
    startBackgroundMusic(options = {}) {
        const { trackKey = this.musicTrack, reason = 'start-background-music', forceSwitch = false } = options;
        if (this.isMuted) return;
        const songPath = this.resolveTrackUrl(trackKey);
        if (!songPath) return;

        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }

        this.lastRequestedTrackKey = trackKey;
        const switchPromise = this.playAudioFile(songPath, {
            trackKey,
            reason,
            forceSwitch,
        });
        this.currentTrackId = Symbol();
        return switchPromise;
    }

    /**
     * Plays an MP3 audio file
     * @param {string} filename - Path to the audio file
     */
    playAudioFile(filename, options = {}) {
        if (!filename) return Promise.resolve();
        const requestedTrackKey = options.trackKey || this.resolveTrackKeyFromUrl(filename) || this.musicTrack;
        const reason = options.reason || 'play-audio-file';
        const forceSwitch = Boolean(options.forceSwitch);

        this.lastRequestedTrackKey = requestedTrackKey;

        if (this.pendingTrackKey === requestedTrackKey) {
            return this.trackSwitchPromise;
        }

        this.pendingTrackKey = requestedTrackKey;
        const requestToken = ++this.trackRequestToken;

        this.trackSwitchPromise = this.trackSwitchPromise
            .catch(() => { })
            .then(async () => {
                // Last-request-wins: only the newest queued request is allowed to apply.
                if (requestToken !== this.trackRequestToken) {
                    return;
                }

                try {
                    await this.performTrackSwitch({
                        filename,
                        trackKey: requestedTrackKey,
                        requestToken,
                        useFade: true,
                        forceSwitch,
                    });
                } catch (error) {
                    if (error?.name === 'AbortError') {
                        return;
                    }

                    try {
                        await this.performTrackSwitch({
                            filename,
                            trackKey: requestedTrackKey,
                            requestToken,
                            useFade: false,
                            forceSwitch: true,
                        });
                    } catch (fallbackError) {
                        if (fallbackError?.name !== 'AbortError') {
                            console.error('[SoundManager] Music switch failed:', fallbackError);
                            this.emitMusicPlaybackError({
                                reason,
                                trackKey: requestedTrackKey,
                                requestedSrc: filename,
                                message: fallbackError?.message || String(fallbackError),
                            });
                        }
                    }
                } finally {
                    if (requestToken === this.trackRequestToken) {
                        this.pendingTrackKey = null;
                    }
                    this.playPromise = null;
                    this.cancelMusicVolumeFade();
                    if (this.audioElement) {
                        this.audioElement.muted = this.isMuted;
                        if (!this.isMuted) {
                            this.setAudioElementVolume(this.getMusicVolume());
                        }
                    }
                }
            });

        return this.trackSwitchPromise;
    }

    /**
     * Stops all background music
     */
    stopBackgroundMusic() {
        this.currentTrackId = null;
        this.pendingTrackKey = null;
        this.trackRequestToken += 1;
        this.cancelMusicVolumeFade();

        if (this.musicInterval) {
            clearInterval(this.musicInterval);
            this.musicInterval = null;
        }

        if (this.audioElement) {
            // Wait for any pending play promise before pausing to avoid AbortError
            const doPause = () => {
                this.audioElement.pause();
                this.audioElement.currentTime = 0;
                this.setAudioElementVolume(this.getMusicVolume());
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
        this.musicVolume = clampUnitVolume(volume, 1.0);
        if (this.audioElement) {
            this.setAudioElementVolume(this.musicVolume);
        }
    }

    setSFXVolume(volume) {
        this.sfxVolume = clampUnitVolume(volume, 1.0);
    }

    cleanup() {
        this.stopBackgroundMusic();
        this.disposeAudioAnalysis();
        this.unbindRuntimeAudioHooks();

        if (this.audioElement) {
            this.audioElement.removeEventListener('ended', this.onAudioEnded);
            this.audioElement.src = '';
            this.audioElement.load();
            this.audioElement = null;
        }

        if (this.preloadAudioElement) {
            this.preloadAudioElement.src = '';
            this.preloadAudioElement = null;
        }

        this.disposeSfxBus();
        this.playPromise = null;
        this.currentTrackId = null;
        this.pendingTrackKey = null;
        this.lastRequestedTrackKey = null;
        this.lastAppliedTrackKey = null;
        this.musicInterval = null;
        this.pendingThemeLinkedTrack = null;
        this.preloadedTrackKey = null;
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
