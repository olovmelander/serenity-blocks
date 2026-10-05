/**
 * BreathworkAudioManager - Handles teacher voice and ambient audio
 * Manages caching, playback, and volume control for breathwork sessions.
 */
export class BreathworkAudioManager {
    constructor() {
        this.voiceAudio = new Audio();
        this.cueAudio = new Audio();

        this.basePath = `${import.meta.env.BASE_URL}assets/audio/breathwork/`;
        this.isEnabled = true;
        this.voiceVolume = 0.8;
        this.cueVolume = 0.6;

        // Preloaded audio cache to prevent lag
        this.audioCache = new Map();
        this.preloadLoads = new Map();
        this.preloadQueue = [];
        this.activePreloadCount = 0;
        this.preloadGeneration = 0;
        this.voiceGeneration = 0;
        this.cueGeneration = 0;
        this.destroyed = false;

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
        if (this.destroyed || !sessionPhaseData || !sessionPhaseData.phases) return;

        console.log(`[AudioManager] Preloading audio for session: ${sessionId}`);

        // Extract all unique audio paths from phases
        const pathsToLoad = new Set();

        sessionPhaseData.phases.forEach((phase) => {
            if (phase.audio) {
                if (phase.audio.voice) pathsToLoad.add(`voices/${phase.audio.voice}`);
                if (phase.audio.transition) pathsToLoad.add(`voices/${phase.audio.transition}`);
                if (phase.audio.cue) pathsToLoad.add(phase.audio.cue);
                if (phase.audio.cues) {
                    // Handle object format { in: '...', out: '...' }
                    if (phase.audio.cues.in) pathsToLoad.add(phase.audio.cues.in);
                    if (phase.audio.cues.out) pathsToLoad.add(phase.audio.cues.out);
                }
                if (phase.audio.fillers) {
                    phase.audio.fillers.forEach((filler) => pathsToLoad.add(`voices/${filler}`));
                }
            }
        });

        const paths = [...pathsToLoad].filter((path) => !this.audioCache.has(path));
        const generation = this.preloadGeneration;
        let next = 0;
        const loadNext = () => {
            if (this.destroyed || generation !== this.preloadGeneration || next >= paths.length) {
                return Promise.resolve();
            }
            const relativePath = paths[next++];
            return this._loadAudio(relativePath).then(loadNext);
        };
        try {
            // Session entry must not start dozens of media pipelines at once.
            await Promise.all(Array.from({ length: Math.min(4, paths.length) }, loadNext));
            if (generation === this.preloadGeneration) console.log(`[AudioManager] Preloaded ${paths.length} files`);
        } catch (err) {
            console.warn('[AudioManager] Some files failed to load (run generation script?)', err);
        }
    }

    /**
     * Internal load helper
     */
    _loadAudio(relativePath) {
        if (this.destroyed || this.audioCache.has(relativePath)) return Promise.resolve();
        const existing = this.preloadLoads.get(relativePath);
        if (existing) return existing.promise;
        const generation = this.preloadGeneration;
        const url = this.basePath + relativePath;
        const entry = {
            audio: null, promise: null, finish: null, start: null,
        };
        let finish;
        entry.promise = new Promise((resolve) => { finish = resolve; });
        this.preloadLoads.set(relativePath, entry);
        let timeout = null;
        entry.finish = (loaded = false) => {
            if (!finish) return;
            if (loaded && !this.destroyed && generation === this.preloadGeneration) {
                this.audioCache.set(relativePath, url);
            }
            clearTimeout(timeout);
            if (entry.audio) {
                const { audio } = entry;
                audio.oncanplaythrough = null;
                audio.onerror = null;
                audio.pause();
                if (audio.removeAttribute) audio.removeAttribute('src');
                else audio.src = '';
                audio.load();
                this.activePreloadCount -= 1;
            }
            if (this.preloadLoads.get(relativePath) === entry) this.preloadLoads.delete(relativePath);
            const resolve = finish;
            finish = null;
            resolve();
            this._drainPreloads();
        };
        entry.start = () => {
            const audio = new Audio();
            entry.audio = audio;
            this.activePreloadCount += 1;
            audio.oncanplaythrough = () => entry.finish(true);
            audio.onerror = () => {
                console.warn(`[AudioManager] Missing file: ${relativePath}`);
                entry.finish();
            };
            timeout = setTimeout(() => entry.finish(), 20000);
            audio.preload = 'auto';
            audio.src = url;
            audio.load();
        };
        this.preloadQueue.push(entry);
        this._drainPreloads();
        return entry.promise;
    }

    _drainPreloads() {
        while (!this.destroyed && this.activePreloadCount < 4 && this.preloadQueue.length) {
            this.preloadQueue.shift().start();
        }
    }

    cancelPreloads() {
        this.preloadGeneration += 1;
        this.preloadQueue.length = 0;
        for (const entry of this.preloadLoads.values()) entry.finish();
        this.preloadLoads.clear();
    }

    /**
     * Play teacher voice for a phase
     * @param {string} relativePath - e.g., 'base/r1_active.mp3'
     */
    playVoice(relativePath) {
        if (this.destroyed || !this.isEnabled || !relativePath) return;
        this._playVoice(relativePath);
    }

    /**
     * Play voice and execute callback when finished
     * Used for sequential voice chaining to prevent overlaps
     * @param {string} relativePath - Voice file path
     * @param {function} onComplete - Callback when audio ends
     */
    playVoiceWithCallback(relativePath, onComplete) {
        if (this.destroyed) return;
        if (!this.isEnabled || !relativePath) {
            if (onComplete) onComplete();
            return;
        }

        this._playVoice(relativePath, onComplete);
    }

    _playVoice(relativePath, onComplete = null) {
        const generation = ++this.voiceGeneration;
        const audio = this.voiceAudio;
        const isCurrent = () => !this.destroyed && generation === this.voiceGeneration && audio === this.voiceAudio;
        this.isVoicePending = false;
        if (this.voicePendingTimeout) {
            clearTimeout(this.voicePendingTimeout);
            this.voicePendingTimeout = null;
        }

        // Stop any currently playing cue to prevent overlap
        this.cueGeneration += 1;
        this.cueAudio.pause();
        this.cueAudio.currentTime = 0;

        // Stop current voice if any
        this.voiceAudio.pause();
        this.voiceAudio.src = `${this.basePath}voices/${relativePath}`;
        this.voiceAudio.volume = this.voiceVolume;

        this.currentVoicePath = relativePath;
        this.isVoicePlaying = true;
        console.log(`[AudioManager] Playing voice (chained): ${relativePath}`);

        let completed = false;
        const finish = (error = null) => {
            if (completed || !isCurrent()) return;
            completed = true;
            audio.onended = null;
            this.isVoicePlaying = false;
            this.isVoicePending = false;
            if (error) console.warn('[AudioManager] Play failed:', error);
            else console.log(`[AudioManager] Voice finished: ${relativePath}`);
            // A chain may wait before its next voice, keeping this generation
            // current. Settle it once even if failure and ended events overlap.
            if (onComplete) onComplete();
        };
        this.voiceAudio.onended = () => finish();
        this.finishVoice = finish;
        this.voiceAudio.play().catch(finish);
    }

    /** Hold the voice where it is. Its completion callback stays armed for resumeAll(). */
    pauseAll() {
        if (this.destroyed) return;
        this.voiceHeld = this.isVoicePlaying;
        this.voiceAudio.pause();
        this.cueGeneration += 1;
        this.cueAudio.pause();
        this.cueAudio.currentTime = 0;
    }

    /** Continue a held voice. If playback cannot restart, settle it so its chain moves on. */
    resumeAll() {
        if (this.destroyed || !this.voiceHeld) return;
        this.voiceHeld = false;
        if (!this.isVoicePlaying) return;
        const finish = this.finishVoice;
        Promise.resolve(this.voiceAudio.play()).catch((error) => finish?.(error));
    }

    /**
     * Schedule voice to play after delay (marks pending state to block cues)
     * @param {string} relativePath - Voice file path
     * @param {number} delayMs - Delay in milliseconds
     */
    scheduleVoice(relativePath, delayMs) {
        if (this.destroyed || !this.isEnabled || !relativePath) return;
        clearTimeout(this.voicePendingTimeout);

        // Set pending state to block cues during the delay
        this.isVoicePending = true;

        this.voicePendingTimeout = setTimeout(() => {
            this.voicePendingTimeout = null;
            this.playVoice(relativePath);
        }, delayMs);
    }

    /**
     * Play a quick cue (breathe in, breathe out, etc.)
     * Only plays if no voice is currently playing or pending
     * @param {string} cuePath - e.g., 'voices/cues/breathe_in.wav'
     */
    playCue(cuePath) {
        if (this.destroyed || !this.isEnabled || !cuePath) return;

        // Don't play cue if voice is currently playing or about to play
        if (this.isVoicePlaying || this.isVoicePending) {
            console.log(`[AudioManager] Skipping cue (voice playing/pending): ${cuePath}`);
            return;
        }

        const fullPath = this.basePath + cuePath;
        console.log(`[AudioManager] Playing cue: ${cuePath}`);
        this.cueAudio.src = fullPath;
        this.cueAudio.volume = this.cueVolume;

        const generation = ++this.cueGeneration;
        this.cueAudio.play().catch((e) => {
            if (!this.destroyed && generation === this.cueGeneration) console.warn('[AudioManager] Cue failed:', e);
        });
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
        this.voiceGeneration += 1;
        this.cueGeneration += 1;
        this.cancelPreloads();
        if (this.voicePendingTimeout) {
            clearTimeout(this.voicePendingTimeout);
            this.voicePendingTimeout = null;
        }
        this.isVoicePending = false;
        this.isVoicePlaying = false;
        this.voiceHeld = false;
        this.finishVoice = null;
        this.currentVoicePath = null;
        if (this.voiceAudio) {
            this.voiceAudio.onended = null;
            this.voiceAudio.pause();
            this.voiceAudio.currentTime = 0;
        }
        if (this.cueAudio) {
            this.cueAudio.pause();
            this.cueAudio.currentTime = 0;
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        if (this.destroyed) return;
        this.stopAll();
        this.destroyed = true;
        this.audioCache.clear();
        for (const audio of [this.voiceAudio, this.cueAudio]) {
            audio.src = '';
            audio.load();
        }
        this.voiceAudio = null;
        this.cueAudio = null;
    }
}
