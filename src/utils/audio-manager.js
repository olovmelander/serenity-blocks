/**
 * @fileoverview Audio Manager - Centralized audio context and resource management
 * 
 * Manages Web Audio API contexts, prevents multiple context creation,
 * handles cleanup, and ensures proper audio resource disposal.
 * 
 * @example
 * import { audioManager } from './utils/audio-manager.js';
 * 
 * // Get audio context
 * const ctx = audioManager.getContext();
 * 
 * // Load and play audio
 * const buffer = await audioManager.loadBuffer('/music/theme.mp3');
 * const source = audioManager.playBuffer(buffer, { loop: true, volume: 0.5 });
 * 
 * // Clean up
 * audioManager.stopAll();
 */

/**
 * Audio Manager - Manages Web Audio API contexts and audio resources
 */
export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.bufferCache = new Map(); // url -> AudioBuffer
        this.activeSources = new Set(); // Active AudioBufferSourceNodes
        this.activeElements = new Set(); // Active <audio> elements
        this.masterGain = null;
        
        // Statistics
        this.stats = {
            buffersLoaded: 0,
            cacheHits: 0,
            cacheMisses: 0,
            activePlaying: 0
        };
        
        // Auto-suspend on visibility change
        this.setupVisibilityHandling();
    }

    /**
     * Get or create audio context
     * @returns {AudioContext}
     */
    getContext() {
        if (!this.audioContext) {
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                this.audioContext = new AudioContextClass();
                
                // Create master gain node
                this.masterGain = this.audioContext.createGain();
                this.masterGain.connect(this.audioContext.destination);
                
                console.log('[AudioManager] Audio context created:', {
                    sampleRate: this.audioContext.sampleRate,
                    state: this.audioContext.state
                });
            } catch (error) {
                console.error('[AudioManager] Failed to create audio context:', error);
                return null;
            }
        }
        
        // Resume if suspended (browsers may auto-suspend)
        if (this.audioContext.state === 'suspended') {
            this.resume();
        }
        
        return this.audioContext;
    }

    /**
     * Resume audio context
     */
    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('[AudioManager] Context resumed');
            } catch (error) {
                console.error('[AudioManager] Failed to resume context:', error);
            }
        }
    }

    /**
     * Suspend audio context
     */
    async suspend() {
        if (this.audioContext && this.audioContext.state === 'running') {
            try {
                await this.audioContext.suspend();
                console.log('[AudioManager] Context suspended');
            } catch (error) {
                console.error('[AudioManager] Failed to suspend context:', error);
            }
        }
    }

    /**
     * Load audio buffer from URL
     * @param {string} url - Audio file URL
     * @returns {Promise<AudioBuffer>}
     */
    async loadBuffer(url) {
        // Check cache first
        if (this.bufferCache.has(url)) {
            this.stats.cacheHits++;
            console.log(`[AudioManager] Buffer cache hit: ${url}`);
            return this.bufferCache.get(url);
        }

        this.stats.cacheMisses++;
        console.log(`[AudioManager] Loading buffer: ${url}`);
        
        const context = this.getContext();
        if (!context) {
            throw new Error('Audio context not available');
        }

        try {
            const startTime = performance.now();
            
            // Fetch audio file
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch audio: ${response.status}`);
            }
            
            const arrayBuffer = await response.arrayBuffer();
            
            // Decode audio data
            const audioBuffer = await context.decodeAudioData(arrayBuffer);
            
            const loadTime = performance.now() - startTime;
            
            // Cache the buffer
            this.bufferCache.set(url, audioBuffer);
            this.stats.buffersLoaded++;
            
            console.log(`[AudioManager] Loaded buffer: ${url} in ${loadTime.toFixed(2)}ms (${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.numberOfChannels}ch)`);
            
            return audioBuffer;
        } catch (error) {
            console.error(`[AudioManager] Failed to load buffer: ${url}`, error);
            throw error;
        }
    }

    /**
     * Play audio buffer
     * @param {AudioBuffer} buffer - Audio buffer to play
     * @param {Object} options - Playback options
     * @returns {AudioBufferSourceNode} Audio source node
     */
    playBuffer(buffer, options = {}) {
        const context = this.getContext();
        if (!context || !buffer) {
            return null;
        }

        const {
            loop = false,
            volume = 1.0,
            playbackRate = 1.0,
            detune = 0,
            startTime = 0,
            offset = 0,
            duration = undefined
        } = options;

        try {
            // Create source node
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = loop;
            source.playbackRate.value = playbackRate;
            source.detune.value = detune;

            // Create gain node for volume control
            const gainNode = context.createGain();
            gainNode.gain.value = volume;

            // Connect: source -> gain -> master -> destination
            source.connect(gainNode);
            gainNode.connect(this.masterGain);

            // Track active source
            this.activeSources.add(source);
            this.stats.activePlaying++;

            // Auto-cleanup when source ends
            source.onended = () => {
                this.activeSources.delete(source);
                this.stats.activePlaying--;
                source.disconnect();
                gainNode.disconnect();
            };

            // Start playback
            if (duration !== undefined) {
                source.start(startTime, offset, duration);
            } else {
                source.start(startTime, offset);
            }

            console.log(`[AudioManager] Playing buffer (loop: ${loop}, volume: ${volume}, active: ${this.stats.activePlaying})`);

            // Return source and gain for external control
            source.gainNode = gainNode;
            return source;
        } catch (error) {
            console.error('[AudioManager] Failed to play buffer:', error);
            return null;
        }
    }

    /**
     * Create and manage HTML audio element
     * @param {string} url - Audio file URL
     * @param {Object} options - Audio options
     * @returns {HTMLAudioElement}
     */
    createAudioElement(url, options = {}) {
        const {
            loop = false,
            volume = 1.0,
            autoplay = false,
            preload = 'auto'
        } = options;

        const audio = new Audio(url);
        audio.loop = loop;
        audio.volume = volume;
        audio.preload = preload;

        // Track active element
        this.activeElements.add(audio);

        // Auto-cleanup when audio ends (if not looping)
        audio.addEventListener('ended', () => {
            if (!audio.loop) {
                this.activeElements.delete(audio);
            }
        });

        if (autoplay) {
            audio.play().catch(error => {
                console.warn('[AudioManager] Autoplay failed:', error);
            });
        }

        console.log(`[AudioManager] Created audio element: ${url} (active elements: ${this.activeElements.size})`);

        return audio;
    }

    /**
     * Stop specific audio source
     * @param {AudioBufferSourceNode} source - Source to stop
     */
    stopSource(source) {
        if (source && this.activeSources.has(source)) {
            try {
                source.stop();
                this.activeSources.delete(source);
                this.stats.activePlaying--;
                console.log(`[AudioManager] Stopped source (active: ${this.stats.activePlaying})`);
            } catch (error) {
                console.error('[AudioManager] Failed to stop source:', error);
            }
        }
    }

    /**
     * Stop all active audio sources
     */
    stopAll() {
        console.log(`[AudioManager] Stopping all audio (${this.activeSources.size} sources, ${this.activeElements.size} elements)...`);

        // Stop all Web Audio API sources
        for (const source of this.activeSources) {
            try {
                source.stop();
                source.disconnect();
            } catch (error) {
                // Source may have already stopped
            }
        }
        this.activeSources.clear();
        this.stats.activePlaying = 0;

        // Stop all HTML audio elements
        for (const audio of this.activeElements) {
            try {
                audio.pause();
                audio.currentTime = 0;
                audio.src = '';
            } catch (error) {
                console.error('[AudioManager] Failed to stop audio element:', error);
            }
        }
        this.activeElements.clear();

        console.log('✅ [AudioManager] All audio stopped');
    }

    /**
     * Set master volume
     * @param {number} volume - Volume (0.0 to 1.0)
     */
    setMasterVolume(volume) {
        if (this.masterGain) {
            this.masterGain.gain.value = Math.max(0, Math.min(1, volume));
            console.log(`[AudioManager] Master volume: ${volume}`);
        }
    }

    /**
     * Get master volume
     * @returns {number} Current master volume
     */
    getMasterVolume() {
        return this.masterGain ? this.masterGain.gain.value : 1.0;
    }

    /**
     * Fade volume in/out
     * @param {number} targetVolume - Target volume (0.0 to 1.0)
     * @param {number} duration - Fade duration in seconds
     */
    fadeMasterVolume(targetVolume, duration = 1.0) {
        if (!this.masterGain || !this.audioContext) return;

        const currentTime = this.audioContext.currentTime;
        this.masterGain.gain.cancelScheduledValues(currentTime);
        this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, currentTime);
        this.masterGain.gain.linearRampToValueAtTime(targetVolume, currentTime + duration);

        console.log(`[AudioManager] Fading to ${targetVolume} over ${duration}s`);
    }

    /**
     * Clear buffer cache
     */
    clearCache() {
        console.log(`[AudioManager] Clearing ${this.bufferCache.size} cached buffers...`);
        this.bufferCache.clear();
        console.log('✅ [AudioManager] Buffer cache cleared');
    }

    /**
     * Setup visibility handling (suspend when hidden)
     */
    setupVisibilityHandling() {
        if (typeof document === 'undefined') return;

        this.visibilityHandler = () => {
            if (document.hidden) {
                this.suspend();
            } else {
                this.resume();
            }
        };

        document.addEventListener('visibilitychange', this.visibilityHandler);
        console.log('[AudioManager] Visibility handling enabled');
    }

    /**
     * Get statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            ...this.stats,
            cachedBuffers: this.bufferCache.size,
            activeSources: this.activeSources.size,
            activeElements: this.activeElements.size,
            contextState: this.audioContext?.state || 'none',
            masterVolume: this.getMasterVolume()
        };
    }

    /**
     * Log status to console
     */
    logStatus() {
        const stats = this.getStats();
        
        console.group('[AudioManager] Status');
        console.log(`Context: ${stats.contextState}`);
        console.log(`Master Volume: ${stats.masterVolume.toFixed(2)}`);
        console.log(`Active Sources: ${stats.activeSources}`);
        console.log(`Active Elements: ${stats.activeElements}`);
        console.log(`Cached Buffers: ${stats.cachedBuffers}`);
        console.log(`Buffers Loaded: ${stats.buffersLoaded}`);
        console.log(`Cache Hit Rate: ${stats.cacheHits}/${stats.cacheHits + stats.cacheMisses}`);
        console.groupEnd();
    }

    /**
     * Clean up all resources
     */
    cleanup() {
        console.log('[AudioManager] Cleaning up...');

        // Stop all audio
        this.stopAll();

        // Remove visibility handler
        if (this.visibilityHandler) {
            document.removeEventListener('visibilitychange', this.visibilityHandler);
            this.visibilityHandler = null;
        }

        // Clear cache
        this.clearCache();

        // Close audio context
        if (this.audioContext) {
            this.audioContext.close().then(() => {
                console.log('✅ [AudioManager] Audio context closed');
            }).catch(error => {
                console.error('[AudioManager] Failed to close context:', error);
            });
            
            this.audioContext = null;
            this.masterGain = null;
        }

        console.log('✅ [AudioManager] Cleanup complete');
    }
}

/**
 * Global singleton audio manager
 */
export const audioManager = new AudioManager();

// Expose to window for debugging
if (typeof window !== 'undefined') {
    window.audioManager = audioManager;
    console.log('💡 Audio manager available: window.audioManager.logStatus()');
}

