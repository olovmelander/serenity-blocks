// @ts-check

/**
 * Shared theme camera rig — breathing, pointer parallax and impact shake.
 *
 * Every theme wants the same three things from its camera: a slow idle float so a
 * static scene still feels alive, a pointer-driven parallax so the depth layers move
 * against each other, and a percussive shake when the board resolves. This is that,
 * once, so a theme does not hand-roll its own.
 *
 * ── Why amplitudes are SCREEN FRACTIONS, not world units ────────────────────────
 * Theme rigs are nowhere near the same scale: aurora sits 15 units from its subject,
 * blood-moon and cosmic-noir sit ~1200. A shake of "0.05 units" is a firm knock on
 * one and literally invisible on the other. What the viewer actually perceives is the
 * ANGLE the view swings through, as a fraction of the vertical FOV — so that is the
 * unit here. `amount` is a fraction of viewport HEIGHT: 0.0046 means "move the image
 * about 0.46% of the screen", ≈5 px at 1080p, whatever the world scale or FOV.
 * Internally: worldOffset = amount * fovRadians * distanceToFocus.
 *
 * ── Composing with a theme that already drives its camera ───────────────────────
 * apply(dt, base) takes the position the theme wants THIS frame and layers its own
 * contribution on top — so a theme with bespoke orbital choreography keeps it. The
 * base is passed explicitly rather than read back off the camera, because these
 * themes assign `camera.position.x = ...` (overwriting, not accumulating) and some
 * never write every axis; inferring the base by subtracting last frame's offset
 * would silently corrupt exactly those axes. Omit `base` for a static camera and the
 * rig uses the rest position it was given.
 *
 * Deliberately imports nothing — not even three. Themes load either `three` or
 * `three/webgpu`, and this only needs `camera.position` (x/y/z), `camera.fov`,
 * `camera.lookAt(x,y,z)` and `camera.rotateZ()`. That also makes it unit-testable
 * with a plain object stand-in, no GPU.
 */

const DEG2RAD = Math.PI / 180;

// Idle float ("breathing") — two incommensurate periods so it never visibly loops.
const BREATH_X_PERIOD = 18; // seconds
const BREATH_Y_PERIOD = 27;
const BREATH_X_AMOUNT = 0.026; // fraction of viewport height
const BREATH_Y_AMOUNT = 0.019;

// Pointer parallax — an arc around the focal point, damped so it never snaps.
const POINTER_X_AMOUNT = 0.185; // fraction of viewport height at full deflection
const POINTER_Y_AMOUNT = 0.112;
const POINTER_Z_AMOUNT = 0.062; // slight push-in toward the edges
const POINTER_DAMP_RATE = 2.6; // s^-1

// Impact shake. Incommensurate frequencies so the rattle never collapses into one
// visible sine, and low enough to stay well-sampled at 60 Hz (Nyquist = 30 Hz).
const SHAKE_FREQ_X = 8.9; // Hz
const SHAKE_FREQ_Y = 11.7;
const SHAKE_FREQ_ROLL = 6.1;
const SHAKE_ROLL_PER_UNIT = 0.34; // radians of roll per unit of shake ANGLE

/**
 * The one shake grammar every theme shares, in screen fractions + milliseconds.
 * Ordering is the design: a bare lock is the faintest cue in the game, and every
 * line clear out-punches it. Tuned on Starlight, then normalised to be scale- and
 * FOV-independent (see the header).
 */
export const SHAKE = Object.freeze({
    LOCK: [0.0046, 90], // ~5 px at 1080p — a tap; this fires on EVERY piece
    TSPIN: [0.0133, 130],
    TETRIS: [0.0225, 150],
    APEX: [0.0307, 190], // combo apex / perfect clear — the biggest hit in the game
    CLEAR_MS: 120,
    CLEAR_PER_LINE: 0.0056,
    CLEAR_COMBO_STEP: 0.0018, // per combo past the first
    CLEAR_COMBO_MAX: 0.0082,
    CLEAR_MAX: 0.0205, // ~22 px — the ceiling for an ordinary clear
});

/**
 * Shake for a line clear, escalating with BOTH the line count and the combo chain.
 * @param {number} lineCount lines cleared this resolution (>= 1)
 * @param {number} comboCount current combo chain (0/1 = no chain)
 * @returns {[number, number]} [amount as a screen fraction, duration in ms]
 */
export function clearShake(lineCount = 1, comboCount = 0) {
    const lines = Math.max(1, Number(lineCount) || 1);
    const combo = Math.max(0, Number(comboCount) || 0);
    const comboBonus = Math.min(SHAKE.CLEAR_COMBO_MAX, Math.max(0, combo - 1) * SHAKE.CLEAR_COMBO_STEP);
    return [Math.min(SHAKE.CLEAR_MAX, SHAKE.CLEAR_PER_LINE * lines + comboBonus), SHAKE.CLEAR_MS];
}

export class ThemeCameraRig {
    /**
     * @param {any} camera a THREE.PerspectiveCamera (either three build)
     * @param {object} [options]
     * @param {{x:number,y:number,z:number}} [options.focus] point the rig orbits and re-aims at
     * @param {{x:number,y:number,z:number}} [options.rest] base position when apply() is given none
     * @param {boolean} [options.breathe] enable the idle float
     * @param {boolean} [options.pointer] enable pointer parallax
     * @param {boolean} [options.reaim] call lookAt(focus) after applying (default true)
     * @param {number} [options.breatheScale] multiplier on the default breathing amplitude
     * @param {number} [options.pointerScale] multiplier on the default parallax amplitude
     * @param {number} [options.idlePhase] seed for the float; pass explicitly for reproducible captures
     */
    constructor(camera, options = {}) {
        const {
            focus = { x: 0, y: 0, z: 0 },
            rest = camera && camera.position
                ? { x: camera.position.x, y: camera.position.y, z: camera.position.z }
                : { x: 0, y: 0, z: 0 },
            breathe = true,
            pointer = true,
            reaim = true,
            breatheScale = 1,
            pointerScale = 1,
            idlePhase = Math.random() * Math.PI * 2,
        } = options;

        this.camera = camera;
        this.focus = { x: focus.x || 0, y: focus.y || 0, z: focus.z || 0 };
        this.rest = { x: rest.x || 0, y: rest.y || 0, z: rest.z || 0 };
        this.breathe = breathe;
        this.pointer = pointer;
        this.reaim = reaim;
        this.breatheScale = breatheScale;
        this.pointerScale = pointerScale;

        this._idlePhaseSeed = idlePhase;
        this._idlePhase = idlePhase;

        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
        this._pointerX = 0;
        this._pointerY = 0;

        this._shakeAmount = 0; // peak, as a screen fraction
        this._shakeTime = 0;
        this._shakeDuration = 0;
        this._shakePhase = 0;
        this._shakeSeq = 0;
        this._roll = 0;
    }

    /** Pointer position in normalised device coords, each axis in [-1, 1]. */
    setPointer(x, y) {
        this._pointerTargetX = Math.max(-1, Math.min(1, Number(x) || 0));
        this._pointerTargetY = Math.max(-1, Math.min(1, Number(y) || 0));
    }

    /**
     * Fire an impact shake. `amount` is the PEAK swing as a fraction of viewport
     * height (see the SHAKE ladder). A stronger shake overrides one in flight; a
     * weaker one is ignored rather than cutting a big impact short.
     */
    shake(amount = SHAKE.LOCK[0], durationMs = 120) {
        if (!(amount > 0) || amount <= this.currentShakeAmount()) return;
        this._shakeAmount = amount;
        this._shakeDuration = Math.max(16, durationMs) / 1000;
        this._shakeTime = 0;
        // Golden-angle phase offset per trigger so consecutive shakes differ, without
        // Math.random() — a replayed capture must reissue the same phases.
        this._shakeSeq += 1;
        this._shakePhase = this._shakeSeq * 2.399963;
    }

    /** Convenience: the standard lock tap. */
    shakeLock() { this.shake(...SHAKE.LOCK); }

    /** Convenience: a line clear, escalating with lines and combo. */
    shakeClear(lineCount, comboCount) { this.shake(...clearShake(lineCount, comboCount)); }

    /** Envelope-scaled amount of the shake in flight (0 when idle). */
    currentShakeAmount() {
        if (this._shakeAmount <= 0 || this._shakeTime >= this._shakeDuration) return 0;
        const k = 1 - this._shakeTime / this._shakeDuration; // quadratic ease-out
        return this._shakeAmount * k * k;
    }

    /** Distance from the camera's CURRENT base position to the focal point. */
    _focusDistance(baseX, baseY, baseZ) {
        const dx = baseX - this.focus.x;
        const dy = baseY - this.focus.y;
        const dz = baseZ - this.focus.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    }

    /**
     * Layer breathing + parallax + shake onto the camera and write the result.
     * Call once per frame, in place of the theme's own `camera.position` write and
     * `lookAt` (pass the theme's intended position as `base`, and steer the aim with
     * setFocus() if the theme drifts its look target).
     *
     * @param {number} delta seconds since the last call
     * @param {{x:number,y:number,z:number}} [base] the position the theme wants this
     *   frame; defaults to the rig's rest position for a static camera.
     */
    apply(delta, base) {
        const dt = Number.isFinite(delta) ? Math.max(0, Math.min(0.1, delta)) : 0;
        const cam = this.camera;
        if (!cam || !cam.position) return;

        const src = base || this.rest;
        const baseX = src.x || 0;
        const baseY = src.y || 0;
        const baseZ = src.z || 0;

        // One screen-height of arc at the focal plane — the unit every amount is in.
        const fovRad = (cam.fov || 50) * DEG2RAD;
        const screen = fovRad * this._focusDistance(baseX, baseY, baseZ);

        let ox = 0;
        let oy = 0;
        let oz = 0;

        if (this.breathe) {
            this._idlePhase += dt;
            const bx = Math.sin((this._idlePhase / BREATH_X_PERIOD) * Math.PI * 2);
            const by = Math.sin((this._idlePhase / BREATH_Y_PERIOD) * Math.PI * 2);
            ox += bx * BREATH_X_AMOUNT * this.breatheScale * screen;
            oy += by * BREATH_Y_AMOUNT * this.breatheScale * screen;
        }

        if (this.pointer) {
            // Frame-rate-independent damping toward the latest pointer position.
            const damp = 1 - Math.exp(-POINTER_DAMP_RATE * dt);
            this._pointerX += (this._pointerTargetX - this._pointerX) * damp;
            this._pointerY += (this._pointerTargetY - this._pointerY) * damp;
            ox += this._pointerX * POINTER_X_AMOUNT * this.pointerScale * screen;
            oy += -this._pointerY * POINTER_Y_AMOUNT * this.pointerScale * screen;
            oz += Math.abs(this._pointerY) * POINTER_Z_AMOUNT * this.pointerScale * screen;
        }

        let roll = 0;
        const shakeAmount = this.currentShakeAmount();
        if (shakeAmount > 0) {
            const t = this._shakeTime;
            const p = this._shakePhase;
            const TAU = Math.PI * 2;
            const swing = shakeAmount * screen;
            ox += Math.sin((t * SHAKE_FREQ_X + p) * TAU) * swing;
            oy += Math.sin((t * SHAKE_FREQ_Y + p * 1.7) * TAU) * swing;
            // Roll is what actually sells an impact when the subject is a distant sky
            // that barely parallaxes under translation.
            roll = Math.sin((t * SHAKE_FREQ_ROLL + p * 0.6) * TAU) * shakeAmount * fovRad * SHAKE_ROLL_PER_UNIT;
            this._shakeTime += dt;
            if (this._shakeTime >= this._shakeDuration) {
                this._shakeAmount = 0;
                this._shakeTime = 0;
                this._shakeDuration = 0;
            }
        }

        cam.position.x = baseX + ox;
        cam.position.y = baseY + oy;
        cam.position.z = baseZ + oz;

        // Re-aiming is what makes the shake read: translating a camera whose orientation
        // is fixed barely moves a distant subject, but re-aiming at the focal point turns
        // the offset into a view rotation of offset/distance — which is the whole effect.
        if (this.reaim && typeof cam.lookAt === 'function') {
            cam.lookAt(this.focus.x, this.focus.y, this.focus.z);
        }
        // lookAt overwrites the orientation outright, so the full roll is applied each
        // frame rather than a delta — it cannot stack. With reaim:false the caller must
        // likewise have set the orientation from scratch this frame (every theme here
        // calls lookAt every frame); otherwise the roll would wind up over the impact.
        if (roll !== 0 && typeof cam.rotateZ === 'function') cam.rotateZ(roll);
        this._roll = roll;
    }

    /** Move the focal point the rig orbits and re-aims at. */
    setFocus(x, y, z) {
        this.focus.x = x;
        this.focus.y = y;
        this.focus.z = z;
    }

    /**
     * Drop every contribution and rewind the float. The camera is not touched — apply()
     * writes it absolutely from the base, so the next frame lands clean on its own.
     * Counters rewind too, so a replayed run reissues the same sequence — otherwise a
     * phase-locked capture drifts.
     */
    reset() {
        this._roll = 0;
        this._shakeAmount = 0;
        this._shakeTime = 0;
        this._shakeDuration = 0;
        this._shakeSeq = 0;
        this._idlePhase = this._idlePhaseSeed;
        this._pointerX = 0;
        this._pointerY = 0;
        this._pointerTargetX = 0;
        this._pointerTargetY = 0;
    }
}
