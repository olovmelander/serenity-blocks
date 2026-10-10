/**
 * BreathworkAudioManager - the breathing voice: stage lines, short spoken cues, and preloading
 * so a stage never waits on the network. Two elements: the voice, and cues that yield to it (a
 * cue never talks over the voice). The voice follows the game's mute and effects volume.
 *
 * Lines are ids from scripts/tts-script.json ('cues/breathe_in', 'base/r1_active'); the
 * recorded index (breathwork-recorded-voices.js) says which file plays for each.
 */
export class BreathworkAudioManager {
    /**
     * @param {object} [options]
     * @param {(id: string) => string|null} [options.resolveClip] the recorded file for a line,
     *   relative to assets/audio/breathwork/ (e.g. 'voices/cues/hold.mp3'), or null when it is
     *   not recorded: such a line is never requested, and a chain waiting on it moves straight on.
     * @param {() => any} [options.getSound] the game's sound system (mute and effects volume)
     */
    constructor({
        resolveClip = (id) => `voices/${id}.wav`,
        getSound = () => globalThis.window?.__serenitySoundManager ?? null,
    } = {}) {
        this.resolveClip = resolveClip;
        this.getSound = getSound;
        this.voiceAudio = new Audio();
        this.cueAudio = new Audio();

        this.basePath = `${import.meta.env.BASE_URL}assets/audio/breathwork/`;
        this.isEnabled = true;
        this.voiceVolume = 0.85;
        this.cueVolume = 0.7;

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

    /** Whether a line has a recording to play. */
    isRecorded(id) {
        return Boolean(id && this.resolveClip(id));
    }

    /** The game's mute and effects volume, applied to a base level. */
    _level(base) {
        const sound = this.getSound?.();
        if (!sound) return base;
        if (sound.isMuted) return 0;
        const volume = Number(sound.getSfxVolume?.() ?? 1);
        return Number.isFinite(volume) ? base * Math.max(0, Math.min(1, volume)) : base;
    }

    /**
     * Preload every recorded line a session can play, in the order it plays them, so the first
     * stage's lines arrive first.
     * @param {string} sessionId - e.g. 'BASE'
     * @param {object} sessionPhaseData - The detailed session phases object
     * @param {string[]} [extraVoices] - more lines: the intention you chose, the closing, the
     *   world cue words
     */
    async preloadSession(sessionId, sessionPhaseData, extraVoices = []) {
        if (this.destroyed || !sessionPhaseData || !sessionPhaseData.phases) return;

        const pathsToLoad = new Set();
        const line = (id) => {
            const path = id && this.resolveClip(id);
            if (path) pathsToLoad.add(path);
        };
        sessionPhaseData.phases.forEach((phase, index) => {
            const { audio } = phase;
            if (!audio) return;
            line(audio.sessionIntro);
            line(audio.transition);
            line(audio.voice);
            if (index === 0) extraVoices.forEach(line);
            line(audio.cues?.in);
            line(audio.cues?.out);
            line(audio.cues?.hold);
            line(audio.release);
            line(audio.encourage?.clip);
            (audio.fillers || []).forEach(line);
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
        } catch (err) {
            console.warn('[AudioManager] Some files failed to load', err);
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
     * Play a line in the voice.
     * @param {string} id - e.g. 'base/r1_active'
     */
    playVoice(id) {
        if (this.destroyed || !this.isEnabled || !this.isRecorded(id)) return;
        this._playVoice(id);
    }

    /**
     * Play a line, then call back when it ends (or at once when it is not recorded): the way a
     * chain of lines plays without overlapping.
     * @param {string} id - e.g. 'transitions/round1_start'
     * @param {function} onComplete - Callback when the line ends
     */
    playVoiceWithCallback(id, onComplete) {
        if (this.destroyed) return;
        if (!this.isEnabled || !this.isRecorded(id)) {
            if (onComplete) onComplete();
            return;
        }

        this._playVoice(id, onComplete);
    }

    _playVoice(id, onComplete = null) {
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
        this.voiceAudio.src = this.basePath + this.resolveClip(id);
        this.voiceAudio.volume = this._level(this.voiceVolume);

        this.currentVoicePath = id;
        this.isVoicePlaying = true;

        let completed = false;
        const finish = (error = null) => {
            if (completed || !isCurrent()) return;
            completed = true;
            audio.onended = null;
            this.isVoicePlaying = false;
            this.isVoicePending = false;
            if (error && error.name !== 'AbortError') console.warn('[AudioManager] Play failed:', error?.message || error);
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
     * Schedule a line after a delay (marks pending state to block cues)
     * @param {string} id - the line
     * @param {number} delayMs - Delay in milliseconds
     */
    scheduleVoice(id, delayMs) {
        if (this.destroyed || !this.isEnabled || !this.isRecorded(id)) return;
        clearTimeout(this.voicePendingTimeout);

        // Set pending state to block cues during the delay
        this.isVoicePending = true;

        this.voicePendingTimeout = setTimeout(() => {
            this.voicePendingTimeout = null;
            this.playVoice(id);
        }, delayMs);
    }

    /**
     * Play a short cue ("Breathe in…", a world's cue words). Only when the voice is quiet and
     * not about to speak.
     * @param {string} id - e.g. 'cues/breathe_in'
     */
    playCue(id) {
        if (this.destroyed || !this.isEnabled || !this.isRecorded(id)) return;

        // Don't play cue if voice is currently playing or about to play
        if (this.isVoicePlaying || this.isVoicePending) {
            return;
        }

        this.cueAudio.src = this.basePath + this.resolveClip(id);
        this.cueAudio.volume = this._level(this.cueVolume);

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
