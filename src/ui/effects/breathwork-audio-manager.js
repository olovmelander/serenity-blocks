/**
 * BreathworkAudioManager - Handles teacher voice and ambient audio
 * Manages caching, playback, and volume control for breathwork sessions.
 */
export class BreathworkAudioManager {
    constructor() {
        this.voiceAudio = new Audio();
        this.cueAudio = new Audio();

        this.basePath = import.meta.env.BASE_URL + 'assets/audio/breathwork/';
        this.isEnabled = true;
        this.voiceVolume = 0.8;
        this.cueVolume = 0.6;

        // Preloaded audio cache to prevent lag
        this.audioCache = new Map();

        // Track currently playing voice to allow clean interruption
        this.currentVoicePath = null;
        this.isVoicePlaying = false; // Track if voice is currently playing
        this.isVoicePending = false; // Track if voice is about to play (blocks cues)
        this.voicePendingTimeout = null; // Timeout reference for pending state
    }

    /**
     * Preload audio files for a session
     * @param {string} sessionId - e.g. 'base', 'elixir'
     * @param {object} sessionPhaseData - The detailed session phases object
     */
    async preloadSession(sessionId, sessionPhaseData) {
        if (!sessionPhaseData || !sessionPhaseData.phases) return;

        console.log(`[AudioManager] Preloading audio for session: ${sessionId}`);
        const promises = [];

        // Extract all unique audio paths from phases
        const pathsToLoad = new Set();

        sessionPhaseData.phases.forEach(phase => {
            if (phase.audio) {
                if (phase.audio.voice) pathsToLoad.add('voices/' + phase.audio.voice);
                if (phase.audio.transition) pathsToLoad.add('voices/' + phase.audio.transition);
                if (phase.audio.cue) pathsToLoad.add(phase.audio.cue);
                if (phase.audio.cues) {
                    // Handle object format { in: '...', out: '...' }
                    if (phase.audio.cues.in) pathsToLoad.add(phase.audio.cues.in);
                    if (phase.audio.cues.out) pathsToLoad.add(phase.audio.cues.out);
                }
                if (phase.audio.fillers) {
                    phase.audio.fillers.forEach(filler => pathsToLoad.add('voices/' + filler));
                }
            }
        });

        for (const relativePath of pathsToLoad) {
            if (!this.audioCache.has(relativePath)) {
                promises.push(this._loadAudio(relativePath));
            }
        }

        try {
            await Promise.all(promises);
            console.log(`[AudioManager] Preloaded ${promises.length} files`);
        } catch (err) {
            console.warn('[AudioManager] Some files failed to load (run generation script?)', err);
        }
    }

    /**
     * Internal load helper
     */
    _loadAudio(relativePath) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.src = this.basePath + relativePath;
            audio.oncanplaythrough = () => {
                this.audioCache.set(relativePath, audio.src);
                resolve();
            };
            audio.onerror = () => {
                // Resolve anyway so we don't block the session start if a file is missing
                console.warn(`[AudioManager] Missing file: ${relativePath}`);
                resolve();
            };
            audio.load();
        });
    }

    /**
     * Play teacher voice for a phase
     * @param {string} relativePath - e.g., 'base/r1_active.mp3'
     */
    playVoice(relativePath) {
        if (!this.isEnabled || !relativePath) return;

        const fullPath = this.basePath + 'voices/' + relativePath;

        // Clear any pending state
        this.isVoicePending = false;
        if (this.voicePendingTimeout) {
            clearTimeout(this.voicePendingTimeout);
            this.voicePendingTimeout = null;
        }

        // Stop any currently playing cue to prevent overlap ("br" sound)
        this.cueAudio.pause();
        this.cueAudio.currentTime = 0;

        // Stop current voice if any
        this.voiceAudio.pause();
        this.voiceAudio.src = fullPath;
        this.voiceAudio.volume = this.voiceVolume;

        this.currentVoicePath = relativePath;
        this.isVoicePlaying = true; // Track voice playing state
        console.log(`[AudioManager] Playing voice: ${relativePath}`);

        this.voiceAudio.play().catch(e => {
            this.isVoicePlaying = false;
            console.warn('[AudioManager] Play failed:', e);
        });

        // Mark voice as done when it ends
        this.voiceAudio.onended = () => {
            this.isVoicePlaying = false;
        };
    }

    /**
     * Schedule voice to play after delay (marks pending state to block cues)
     * @param {string} relativePath - Voice file path
     * @param {number} delayMs - Delay in milliseconds
     */
    scheduleVoice(relativePath, delayMs) {
        if (!this.isEnabled || !relativePath) return;

        // Set pending state to block cues during the delay
        this.isVoicePending = true;

        this.voicePendingTimeout = setTimeout(() => {
            this.playVoice(relativePath);
        }, delayMs);
    }

    /**
     * Play a quick cue (breathe in, breathe out, etc.)
     * Only plays if no voice is currently playing or pending
     * @param {string} cuePath - e.g., 'voices/cues/breathe_in.wav'
     */
    playCue(cuePath) {
        if (!this.isEnabled || !cuePath) return;

        // Don't play cue if voice is currently playing or about to play
        if (this.isVoicePlaying || this.isVoicePending) {
            console.log(`[AudioManager] Skipping cue (voice playing/pending): ${cuePath}`);
            return;
        }

        const fullPath = this.basePath + cuePath;
        console.log(`[AudioManager] Playing cue: ${cuePath}`);
        this.cueAudio.src = fullPath;
        this.cueAudio.volume = this.cueVolume;

        this.cueAudio.play().catch(e => console.warn('[AudioManager] Cue failed:', e));
    }

    /**
     * Enable/Disable audio
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        if (!enabled) this.stopAll();
    }

    /**
     * Stop all audio
     */
    stopAll() {
        this.voiceAudio.pause();
        this.voiceAudio.currentTime = 0;
        this.cueAudio.pause();
        this.cueAudio.currentTime = 0;
    }

    /**
     * Cleanup
     */
    destroy() {
        this.stopAll();
        this.audioCache.clear();
        this.voiceAudio = null;
        this.cueAudio = null;
    }
}
