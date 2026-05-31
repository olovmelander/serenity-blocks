/**
 * Electric Dreams V3 — Camera Director
 *
 * Cinematic camera choreography. The camera tells a story across the play
 * session by responding to act transitions and beat events.
 *
 * Idle behavior (this file's current scope):
 *   - Slow figure-8 dolly (Lissajous) around the focal point
 *   - Period: 18s (~3 BPM, "lazy float in zero-G" feel)
 *   - Amplitude: 0.4u horizontal, 0.25u vertical
 *
 * Per-event responses (will activate as V3 phases come online):
 *   - HARD_DROP   → small punch toward board impact point
 *   - LINE_CLEAR  → no change (fluid handles the visual)
 *   - TETRIS      → dolly push 0.4u toward fluid center over 0.4s
 *   - COMBO 7+    → dolly-zoom (Vertigo) over 1.2s
 *   - GAME_OVER   → slow pull-back to wide shot over 2s
 *
 * Design constraints (Risk Register §7):
 *   - Max 0.5u displacement, max 3°/s rotation → avoid motion sickness
 *   - All target deltas damped via critically-damped spring (no overshoot, no oscillation)
 */
import * as THREE from 'three';

const DEFAULT_FOCUS = new THREE.Vector3(0, 0, 0);
// Pulled BACK from 12 → 15 units so the wider horizontal fluid composition fits
// the frame. The board sits in the middle of the frame; we want the fluid halo
// to extend ~equal margin left + right of it.
const REST_POSITION = new THREE.Vector3(0, 0.4, 15);

const SPRING_FREQ = 1.4; // Hz — slow, weighty camera feel
const SPRING_DAMP = 1.0; // Critically damped
const MAX_FOV_DELTA = 6; // degrees
const MAX_OFFSET_LEN = 0.5; // units

// Pointer-driven orbital parallax. The cursor maps to a [-1, 1] NDC range,
// which we project onto horizontal/vertical arcs around the focal point.
// Reduced from 2.4/1.4 → 1.8/1.1 because the game board occupies screen center
// and a too-wide swing makes the board feel like it's "floating loose" in the
// scene. Subtler parallax keeps the board anchored visually.
const POINTER_ORBIT_X = 1.8;
const POINTER_ORBIT_Y = 1.1;
const POINTER_ORBIT_Z = 0.6;
const POINTER_LOOKAT_GAIN = 0.28; // slightly less drift — board needs to feel "centered"
const POINTER_DAMP_RATE = 2.6; // s^-1 — higher = snappier follow; lower = lazier glide

// Lissajous parameters — period and amplitude per axis.
// Reduced amplitudes too — at the new pulled-back distance, 0.4u was reading
// as a noticeable wobble. 0.25u/0.18u is subtle "breathing" without distraction.
const IDLE_X_PERIOD = 18;
const IDLE_Y_PERIOD = 27;
const IDLE_X_AMP = 0.25;
const IDLE_Y_AMP = 0.18;

export class CameraDirector {
    constructor(camera, focus = DEFAULT_FOCUS) {
        this.camera = camera;
        this.focus = focus.clone();

        // Rest pose — where camera idles to.
        this.restPosition = REST_POSITION.clone();
        this.restFov = camera.fov;

        // Target = where we WANT to be this frame (animated).
        // Current = where we ARE (spring-damped toward target).
        this._targetPos = REST_POSITION.clone();
        this._targetFov = camera.fov;
        this._currentPos = REST_POSITION.clone();
        this._currentFov = camera.fov;
        this._velocity = new THREE.Vector3();
        this._fovVelocity = 0;

        // Event-driven pose impulse (resets each frame, decays to rest).
        this._eventOffset = new THREE.Vector3();
        this._eventOffsetTarget = new THREE.Vector3();
        this._eventFovDelta = 0;
        this._eventFovDeltaTarget = 0;

        // Idle dolly phase — starts at random offset so multiple sessions don't sync.
        this._idlePhase = Math.random() * Math.PI * 2;

        // Tracking: how much to follow the "hero" point of interest
        // (will be the fluid center once Phase 3 lands).
        this._trackTarget = focus.clone();
        this._trackBlend = 0; // 0 = ignore, 1 = full track

        // Pointer state — driven by setPointer(x, y) from the orchestrator.
        // Target = raw input (whatever mouse-move fired last). Smoothed = lerped
        // toward target every frame for that "weighty" feel; without smoothing
        // the camera jitters with every cursor pixel.
        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this._pointerX = 0;
        this._pointerY = 0;

        // Micro-shake state — for piece-lock taps and other percussive events.
        // Decays linearly over remaining duration; high-freq random jitter.
        this._shakeAmp = 0;
        this._shakeDecayPerMs = 0;

        // Cached look-at vector (reused per frame; no per-frame allocations).
        this._lookAt = new THREE.Vector3();
        this._tmp = new THREE.Vector3();
    }

    /**
     * Adds a quick decaying camera shake. Use for percussive events
     * (piece lock, hard drop). Decay is linear over `durationMs`.
     *
     * @param {number} amplitude  - peak world-space shake (typical 0.02-0.08)
     * @param {number} durationMs - total decay time (typical 80-200)
     */
    shake(amplitude = 0.04, durationMs = 120) {
        // If a stronger shake is already in flight, keep it; otherwise replace.
        // Prevents fast lock cascades from accumulating into wild jitter.
        if (amplitude <= this._shakeAmp) return;
        this._shakeAmp = amplitude;
        this._shakeDecayPerMs = amplitude / Math.max(16, durationMs);
    }

    /**
     * Quick FOV punch — instant zoom-in by `delta` degrees that springs back.
     * Subtle (1-2°) reads as "camera absorbs the impact" tactile feel.
     * Builds on the existing _eventFovDelta system so it composes with
     * the combo-vertigo without fighting.
     */
    fovPunch(delta = -1.5) {
        // Only apply if it's a stronger pull than current pending punch.
        if (Math.abs(delta) <= Math.abs(this._eventFovDeltaTarget)) return;
        this._eventFovDeltaTarget = delta;
    }

    /**
     * Update the pointer target. Coords are NDC ([-1, 1] for both axes),
     * where (-1, -1) is bottom-left and (+1, +1) is top-right.
     * Safe to call at any frequency; smoothing happens in update().
     */
    setPointer(x, y) {
        this._pointerTargetX = Math.max(-1, Math.min(1, x));
        this._pointerTargetY = Math.max(-1, Math.min(1, y));
    }

    /**
     * Per-frame update. Advances idle motion, applies spring damping,
     * decays event-driven impulses.
     */
    update(delta) {
        // 1. Idle figure-8 dolly
        this._idlePhase += delta;
        const idleX = Math.sin((this._idlePhase / IDLE_X_PERIOD) * Math.PI * 2) * IDLE_X_AMP;
        const idleY = Math.sin((this._idlePhase / IDLE_Y_PERIOD) * Math.PI * 2) * IDLE_Y_AMP;
        this._targetPos.copy(this.restPosition);
        this._targetPos.x += idleX;
        this._targetPos.y += idleY;

        // 2. Pointer-driven orbital parallax — smooth toward the target NDC.
        // Frame-rate-independent damping: damp factor = 1 - exp(-rate*dt) gives
        // consistent settling time regardless of FPS. (Plain lerp(a,b,0.1)
        // would settle faster at 120fps than 30fps — bad for cinematic feel.)
        const pointerDamp = 1 - Math.exp(-POINTER_DAMP_RATE * delta);
        this._pointerX += (this._pointerTargetX - this._pointerX) * pointerDamp;
        this._pointerY += (this._pointerTargetY - this._pointerY) * pointerDamp;
        // Mouse right (+X) → camera arcs right; mouse up (+Y, screen-Y is flipped
        // so we negate) → camera tilts up. Mouse up also nudges camera back so
        // looking "up" feels like leaning away from the mass.
        this._targetPos.x += this._pointerX * POINTER_ORBIT_X;
        this._targetPos.y += -this._pointerY * POINTER_ORBIT_Y;
        this._targetPos.z += Math.abs(this._pointerY) * POINTER_ORBIT_Z;

        // 3. Event offset — decays back to 0 (8% per frame at 60fps).
        this._eventOffsetTarget.multiplyScalar(0.92);
        this._eventOffset.lerp(this._eventOffsetTarget, 0.14);
        // Clamp combined idle + event to MAX_OFFSET_LEN — never disorient the player.
        if (this._eventOffset.lengthSq() > MAX_OFFSET_LEN * MAX_OFFSET_LEN) {
            this._eventOffset.setLength(MAX_OFFSET_LEN);
        }
        this._targetPos.add(this._eventOffset);

        // 4. FOV target — base + event delta, clamped.
        this._eventFovDeltaTarget *= 0.92;
        this._eventFovDelta += (this._eventFovDeltaTarget - this._eventFovDelta) * 0.14;
        const clampedFovDelta = Math.max(-MAX_FOV_DELTA, Math.min(MAX_FOV_DELTA, this._eventFovDelta));
        this._targetFov = this.restFov + clampedFovDelta;

        // 5. Spring damping toward target (positional).
        // F = -k*x - c*v (critically damped: c² = 4k)
        const k = (2 * Math.PI * SPRING_FREQ) ** 2;
        const c = 2 * SPRING_DAMP * Math.sqrt(k);
        this._tmp.copy(this._targetPos).sub(this._currentPos).multiplyScalar(k);
        this._tmp.addScaledVector(this._velocity, -c);
        this._velocity.addScaledVector(this._tmp, delta);
        this._currentPos.addScaledVector(this._velocity, delta);

        // 6. FOV damping (1D spring).
        const fovError = this._targetFov - this._currentFov;
        const fovAccel = k * fovError - c * this._fovVelocity;
        this._fovVelocity += fovAccel * delta;
        this._currentFov += this._fovVelocity * delta;

        // 7. Compute look-at point — focal + small pointer-driven offset so
        // the framing follows the cursor (aurora's "dynamic framing" trick).
        // Without this, the camera arcs but always centers on the focal — feels
        // mechanical. Adding ~35% pointer drift to the look-at makes the
        // composition feel intentional, not just rotated.
        this._lookAt.copy(this.focus);
        this._lookAt.x += this._pointerX * POINTER_ORBIT_X * POINTER_LOOKAT_GAIN;
        this._lookAt.y += -this._pointerY * POINTER_ORBIT_Y * POINTER_LOOKAT_GAIN;

        // 8. Apply to camera + micro-shake jitter (post-spring so it doesn't
        // fight the damping). Shake is added directly to final camera position,
        // never to _targetPos — keeps it crisp and instantaneous per frame.
        this.camera.position.copy(this._currentPos);
        if (this._shakeAmp > 0.0001) {
            // Cheap per-frame random: works fine for ~120ms bursts.
            this.camera.position.x += (Math.random() - 0.5) * this._shakeAmp * 2;
            this.camera.position.y += (Math.random() - 0.5) * this._shakeAmp * 2;
            // Linear decay; reaches 0 within `durationMs`.
            this._shakeAmp = Math.max(0, this._shakeAmp - this._shakeDecayPerMs * (delta * 1000));
        }
        this.camera.lookAt(this._lookAt);
        if (Math.abs(this.camera.fov - this._currentFov) > 0.01) {
            this.camera.fov = this._currentFov;
            this.camera.updateProjectionMatrix();
        }
    }

    /**
     * Event response: punch the camera toward `worldPoint` by `strength` units.
     * Decays naturally via spring + 8% per-frame target shrink.
     */
    punch(worldPoint, strength = 0.2) {
        this._tmp.copy(worldPoint).sub(this.camera.position).normalize().multiplyScalar(strength);
        this._eventOffsetTarget.add(this._tmp);
    }

    /**
     * Event response: dolly push toward focus (negative = away).
     */
    dolly(distance) {
        this._tmp.copy(this.focus).sub(this.camera.position).normalize().multiplyScalar(distance);
        this._eventOffsetTarget.add(this._tmp);
    }

    /**
     * Vertigo (dolly-zoom): zoom-in while pulling back, keeping subject size constant.
     * Used for combo 7+ peaks. Visually dramatic, easy to overuse.
     */
    vertigo(strength = 1.0) {
        this.dolly(-0.3 * strength);
        this._eventFovDeltaTarget -= 4 * strength;
    }

    /**
     * Pull-back for game over / quiet moments.
     */
    pullBack(distance = 1.5) {
        this._eventOffsetTarget.z += distance;
    }

    /**
     * Snap camera to rest pose instantly (used on theme.start to skip the
     * springy "drift into position" animation that would happen otherwise).
     */
    snapToRest() {
        this._currentPos.copy(this.restPosition);
        this._targetPos.copy(this.restPosition);
        this._velocity.set(0, 0, 0);
        this._currentFov = this.restFov;
        this._targetFov = this.restFov;
        this._fovVelocity = 0;
        this._eventOffset.set(0, 0, 0);
        this._eventOffsetTarget.set(0, 0, 0);
        this._eventFovDelta = 0;
        this._eventFovDeltaTarget = 0;
        // Reset pointer so re-entering the theme doesn't carry stale cursor state
        this._pointerX = 0;
        this._pointerY = 0;
        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this.camera.position.copy(this._currentPos);
        this.camera.lookAt(this.focus);
        this.camera.fov = this._currentFov;
        this.camera.updateProjectionMatrix();
    }
}
