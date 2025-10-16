/**
 * @fileoverview Phaser 4 Particle Compatibility Layer
 * Provides a compatibility wrapper for particle systems between Phaser 3 and Phaser 4
 *
 * **Purpose:** Handle API differences gracefully to prevent crashes
 *
 * **Phaser 4 Changes:**
 * - EmitterOp properties → direct getters/setters
 * - bounds property → ParticleBounds processor
 * - Some configuration properties may have changed
 *
 * **Strategy:** Try modern API first, fallback to legacy, disable if both fail
 */

/**
 * Safely create a particle emitter with Phaser 3/4 compatibility
 * @param {Phaser.Scene} scene - The scene instance
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {string} textureKey - Particle texture key
 * @param {Object} config - Particle configuration
 * @returns {Object|null} Particle emitter or null if creation failed
 */
export function createParticleEmitter(scene, x, y, textureKey, config) {
    if (!scene || !scene.add) {
        console.warn('[ParticleCompat] Scene or scene.add not available');
        return null;
    }

    if (!scene.textures.exists(textureKey)) {
        console.warn(`[ParticleCompat] Texture "${textureKey}" not found`);
        return null;
    }

    try {
        // Attempt to create particle emitter
        // This API is expected to work in both Phaser 3 and Phaser 4
        const emitter = scene.add.particles(x, y, textureKey, config);

        if (!emitter) {
            console.warn('[ParticleCompat] Particle emitter creation returned null');
            return null;
        }

        console.log('[ParticleCompat] Particle emitter created successfully');
        return emitter;

    } catch (error) {
        console.error('[ParticleCompat] Failed to create particle emitter:', error);
        console.warn('[ParticleCompat] Particle effects will be disabled');
        return null;
    }
}

/**
 * Safely emit particles (handles explode vs other methods)
 * @param {Object} emitter - Particle emitter instance
 * @param {number} count - Number of particles to emit
 * @returns {boolean} Success status
 */
export function emitParticles(emitter, count) {
    if (!emitter) return false;

    try {
        if (typeof emitter.explode === 'function') {
            emitter.explode(count);
            return true;
        } else if (typeof emitter.emit === 'function') {
            emitter.emit(count);
            return true;
        } else {
            console.warn('[ParticleCompat] Emitter has no explode() or emit() method');
            return false;
        }
    } catch (error) {
        console.error('[ParticleCompat] Failed to emit particles:', error);
        return false;
    }
}

/**
 * Safely destroy a particle emitter
 * @param {Object} emitter - Particle emitter instance
 * @returns {boolean} Success status
 */
export function destroyParticleEmitter(emitter) {
    if (!emitter) return false;

    try {
        if (typeof emitter.destroy === 'function') {
            emitter.destroy();
            return true;
        } else {
            console.warn('[ParticleCompat] Emitter has no destroy() method');
            return false;
        }
    } catch (error) {
        console.error('[ParticleCompat] Failed to destroy particle emitter:', error);
        return false;
    }
}

/**
 * Check if particle system is available in the current Phaser version
 * @param {Phaser.Scene} scene - The scene instance
 * @returns {boolean} True if particle system is available
 */
export function isParticleSystemAvailable(scene) {
    return !!(
        scene &&
        scene.add &&
        typeof scene.add.particles === 'function' &&
        scene.textures
    );
}

/**
 * Log Phaser particle API version info (for debugging)
 * @param {Phaser.Scene} scene - The scene instance
 */
export function logParticleSystemInfo(scene) {
    if (!scene) {
        console.log('[ParticleCompat] No scene provided');
        return;
    }

    const info = {
        hasAddParticles: typeof scene.add?.particles === 'function',
        phaserVersion: window.Phaser?.VERSION || 'Unknown',
        available: isParticleSystemAvailable(scene),
    };

    console.log('[ParticleCompat] Particle System Info:', info);
}

