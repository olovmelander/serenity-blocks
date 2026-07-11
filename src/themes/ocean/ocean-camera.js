/**
 * Ocean Theme — Camera State Machine
 *
 * Three moods with smooth 2.5s lerp:
 *   - Drift    : fov 54, reef-forward pitch sway, focalZ 42. Default.
 *   - Cathedral: fov 50, high pitch sway 0.13 (tilts up to shafts), focalZ 78.
 *                Triggered probabilistically when god rays visible upper half.
 *   - Trail    : fov 63, large dolly amp, focalZ 28.
 *                Triggered when a hero fish enters frame.
 *
 * Switches every 14–22s. Updates uFocalDepth each frame for DOF.
 */

const MOODS = {
    DRIFT: 'drift',
    CATHEDRAL: 'cathedral',
    TRAIL: 'trail',
};

const MOOD_PARAMS = {
    [MOODS.DRIFT]: {
        fov: 54,
        pitchSway: 0.065,
        focalZ: 42,
        dollyAmp: 4.2,
    },
    [MOODS.CATHEDRAL]: {
        fov: 50,
        pitchSway: 0.13,
        focalZ: 78,
        dollyAmp: 2.6,
    },
    [MOODS.TRAIL]: {
        fov: 63,
        pitchSway: 0.04,
        focalZ: 28,
        dollyAmp: 7,
    },
};

const LERP_DURATION = 2.5; // seconds
const MIN_SWITCH_INTERVAL = 14;
const MAX_SWITCH_INTERVAL = 22;

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function normalizeFocalDepth(focalZ, camera) {
    const near = camera?.near ?? 0.5;
    const far = camera?.far ?? 500;
    const range = Math.max(1, far - near);
    return Math.max(0.01, Math.min(0.98, (focalZ - near) / range));
}

export class OceanCamera {
    constructor(camera) {
        this.camera = camera;
        this.mood = MOODS.DRIFT;
        this.targetMood = MOODS.DRIFT;
        this.lerpProgress = 1.0; // 1 = fully settled
        this.nextSwitchAt = MIN_SWITCH_INTERVAL + Math.random() * (MAX_SWITCH_INTERVAL - MIN_SWITCH_INTERVAL);
        this.elapsed = 0;

        // Cached param values (for smooth interpolation)
        this.currentParams = { ...MOOD_PARAMS[MOODS.DRIFT] };
        this.fromParams = { ...MOOD_PARAMS[MOODS.DRIFT] };
        this.toParams = { ...MOOD_PARAMS[MOODS.DRIFT] };
        if (this.camera) {
            this.camera.fov = this.currentParams.fov;
            this.camera.updateProjectionMatrix();
        }

        // Focal depth for DOF
        this.focalDepth = normalizeFocalDepth(30, camera);
        this.updateResult = { focalDepth: this.focalDepth };

        // Shake impulse state. Magnitude decays exponentially; per-frame noise
        // is overlaid on top of the existing drift so mood transitions are
        // never interrupted.
        this.shakeMagnitude = 0;
        this.shakeTau = 0.1; // seconds — replaced on each impulse
        // Hold-mood request (set externally for hero moments).
        this.holdMood = null;
        this.holdRemaining = 0;

        // Pointer tracking for parallax
        this.targetPointerX = 0;
        this.targetPointerY = 0;
        this.currentPointerX = 0;
        this.currentPointerY = 0;
    }

    setPointer(x, y) {
        this.targetPointerX = x;
        this.targetPointerY = y;
    }

    /**
     * Add a decaying shake impulse on top of the steady camera drift.
     * @param {number} magnitude  - peak position offset in world units
     * @param {number} durationMs - rough duration; tau ≈ duration/4
     */
    applyShakeImpulse(magnitude, durationMs = 240) {
        if (!Number.isFinite(magnitude) || magnitude <= 0) return;
        const tau = Math.max(0.04, (durationMs || 240) / 4000);
        // Stack peak amplitudes (don't reset) so back-to-back combos compound.
        this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
        this.shakeTau = tau;
    }

    /**
     * Briefly force a mood transition for hero moments (e.g. Tetris). The
     * camera will return to autonomous mood selection when the hold expires.
     */
    requestImpulseMood(mood, durationSeconds = 3.0) {
        if (!MOOD_PARAMS[mood]) return;
        this.setMood(mood);
        this.holdMood = mood;
        this.holdRemaining = durationSeconds;
    }

    /**
     * Force a mood transition.
     */
    setMood(mood) {
        if (!MOOD_PARAMS[mood] || mood === this.targetMood) return;
        this.fromParams = { ...this.currentParams };
        this.toParams = { ...MOOD_PARAMS[mood] };
        this.mood = this.targetMood;
        this.targetMood = mood;
        this.lerpProgress = 0;
    }

    /**
     * Call once per frame.
     * @param {number} delta  - frame delta (seconds)
     * @param {number} time   - total elapsed time
     * @param {Object} hints  - { heroFishVisible, godRaysVisibleUpper }
     * @returns {{ focalDepth: number }} values for DOF uniform
     */
    update(delta, time, hints = {}) {
        this.elapsed += delta;

        // ── Mood transitions ──
        if (this.lerpProgress < 1.0) {
            this.lerpProgress = Math.min(1.0, this.lerpProgress + delta / LERP_DURATION);
            const t = this.lerpProgress * this.lerpProgress * (3 - 2 * this.lerpProgress); // smoothstep
            this.currentParams.fov = lerp(this.fromParams.fov, this.toParams.fov, t);
            this.currentParams.pitchSway = lerp(
                this.fromParams.pitchSway,
                this.toParams.pitchSway,
                t,
            );
            this.currentParams.focalZ = lerp(this.fromParams.focalZ, this.toParams.focalZ, t);
            this.currentParams.dollyAmp = lerp(this.fromParams.dollyAmp, this.toParams.dollyAmp, t);

            if (this.camera.fov !== this.currentParams.fov) {
                this.camera.fov = this.currentParams.fov;
                this.camera.updateProjectionMatrix();
            }
        }

        // ── Hold-mood timer (Tetris hero moment) ──
        if (this.holdMood && this.holdRemaining > 0) {
            this.holdRemaining -= delta;
            if (this.holdRemaining <= 0) {
                this.holdMood = null;
                // Schedule a return to drift on the next auto-switch cycle.
                this.nextSwitchAt = this.elapsed + 0.5;
            }
        }

        // ── Auto mood switch (skipped while a hold is active) ──
        if (
            !this.holdMood
            && this.elapsed >= this.nextSwitchAt
            && this.lerpProgress >= 1.0
        ) {
            let nextMood = MOODS.DRIFT;

            if (hints.heroFishVisible && Math.random() < 0.52) {
                nextMood = MOODS.TRAIL;
            } else if (hints.godRaysVisibleUpper && Math.random() < 0.44) {
                nextMood = MOODS.CATHEDRAL;
            }

            if (nextMood !== this.targetMood) {
                this.setMood(nextMood);
            }
            this.nextSwitchAt = this.elapsed
                + MIN_SWITCH_INTERVAL
                + Math.random() * (MAX_SWITCH_INTERVAL - MIN_SWITCH_INTERVAL);
        }

        // ── Apply camera motion ──
        const p = this.currentParams;

        // Slower lerp for a heavier, more cinematic feel
        this.currentPointerX += (this.targetPointerX - this.currentPointerX) * delta * 1.5;
        this.currentPointerY += (this.targetPointerY - this.currentPointerY) * delta * 1.5;

        // Combine pointer parallax
        // Preserve the authored sun/monument frame while retaining a gentle
        // sense of underwater parallax at the pointer extremes.
        const parallaxX = this.currentPointerX * 14.0;
        const parallaxY = this.currentPointerY * 7.0;

        // Smooth continuous camera drift (underwater floating feel)
        const drift1 = Math.sin(time * 0.045) * 9;
        const drift2 = Math.sin(time * 0.072 + 1.5) * 5;
        const drift3 = Math.cos(time * 0.028) * 7;

        // Shake impulse: high-frequency noise scaled by exponentially-decaying
        // magnitude. Position offset peaks ~magnitude*1.0; lookAt jitter peaks
        // ~magnitude*0.6 so the world stays roughly framed.
        if (this.shakeMagnitude > 0.0001) {
            this.shakeMagnitude *= Math.exp(-delta / this.shakeTau);
            if (this.shakeMagnitude < 0.0005) this.shakeMagnitude = 0;
        }
        const shakeMag = this.shakeMagnitude;
        const shakeNoiseX = Math.sin(time * 47.3) * Math.cos(time * 31.7);
        const shakeNoiseY = Math.sin(time * 53.1 + 1.7) * Math.cos(time * 29.3);
        const shakeNoiseZ = Math.sin(time * 41.9 + 0.4) * Math.cos(time * 37.5);

        this.camera.position.x = parallaxX
            + drift1
            + Math.sin(time * 0.12) * 2.4
            + shakeNoiseX * shakeMag;
        this.camera.position.y = 24
            + parallaxY
            + Math.sin(time * 0.07) * 4
            + Math.sin(time * 0.15) * 1.5
            + shakeNoiseY * shakeMag * 0.7;
        this.camera.position.z = 82
            + drift3 * 0.5
            + Math.sin(time * 0.055) * p.dollyAmp
            + shakeNoiseZ * shakeMag * 0.4;

        // Look-at target that drifts gently — Cathedral adds upward pitch
        const lookX = this.currentPointerX * 16.0
            + drift2 * 0.4
            + Math.sin(time * 0.04) * 3
            + shakeNoiseY * shakeMag * 0.6;
        const pitchOffset = Math.sin(time * 0.06) * p.pitchSway * 50;
        const lookY = this.currentPointerY * 8.0 + 8
            + Math.sin(time * 0.055) * 3.4
            + pitchOffset
            + shakeNoiseX * shakeMag * 0.5;
        const lookZ = -34 + Math.cos(time * 0.045) * 7 + shakeNoiseZ * shakeMag * 0.3;
        this.camera.lookAt(lookX, lookY, lookZ);

        // Subtle camera roll for extra underwater feel
        this.camera.rotation.z = Math.sin(time * 0.04) * 0.015 + shakeNoiseZ * shakeMag * 0.012;

        // Update normalized focal depth for the post pass.
        this.focalDepth = normalizeFocalDepth(p.focalZ, this.camera);
        this.updateResult.focalDepth = this.focalDepth;

        return this.updateResult;
    }

    collectSignoff() {
        return {
            mood: this.mood,
            targetMood: this.targetMood,
            fov: Math.round((this.camera?.fov ?? this.currentParams.fov) * 100) / 100,
            focalDepth: Math.round(this.focalDepth * 10000) / 10000,
            reefForwardDefault: true,
        };
    }

    dispose() {
        this.camera = null;
        this.updateResult = null;
    }
}

export { MOODS as CAMERA_MOODS };
export default OceanCamera;
