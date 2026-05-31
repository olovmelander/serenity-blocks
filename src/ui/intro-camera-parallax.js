/**
 * Intro Camera Parallax
 *
 * Pointer-driven orbital parallax for the intro / menu-background camera.
 * Ported from the Electric Dreams V3 CameraDirector
 * (src/themes/electric-dreams-v3/composition/camera-director.js), where moving
 * the cursor arcs the camera around the focal point and subtly re-frames the
 * shot. It makes the scene feel alive and hand-held instead of on rails.
 *
 * Usage (per renderer):
 *   init():    this.cameraParallax = new IntroCameraParallax(); this.cameraParallax.attach();
 *   update():  <set camera.position from idle drift>; this.cameraParallax.apply(camera, delta);
 *   destroy(): this.cameraParallax.detach();
 *
 * The renderer keeps full control of the base camera pose (idle Lissajous drift,
 * warp dolly, etc.). `apply()` only ADDS a smoothed offset on top of whatever
 * position is set this frame and performs the final lookAt — so it must be the
 * last thing to touch the camera before rendering.
 *
 * No THREE import on purpose: it only mutates camera.position scalars and calls
 * camera.lookAt(x, y, z), so it works against both the WebGL ('three') and
 * WebGPU ('three/webgpu') builds without risking a duplicate THREE instance.
 */

const DEFAULTS = {
    // World-space camera sway at full cursor deflection. Tuned for the intro's
    // pulled-back framing (camera ~z=40, fov 60) — roughly the Electric Dreams V3
    // amplitudes scaled by the larger camera distance.
    orbitX: 6.0,
    orbitY: 4.0,
    // Depth parallax: looking up/down also nudges the camera back a touch so the
    // tilt reads as "leaning away" rather than a flat pan.
    orbitZ: 2.0,
    // How much the framing point itself follows the cursor (0 = pure rotation,
    // feels mechanical; ~0.3 = composition drifts with you, feels intentional).
    lookAtGain: 0.3,
    // Smoothing rate (s^-1). Higher = snappier follow, lower = lazier glide.
    // Frame-rate independent via damp = 1 - exp(-rate*dt).
    dampRate: 2.6,
};

export class IntroCameraParallax {
    constructor(options = {}) {
        const o = { ...DEFAULTS, ...options };
        this.orbitX = o.orbitX;
        this.orbitY = o.orbitY;
        this.orbitZ = o.orbitZ;
        this.lookAtGain = o.lookAtGain;
        this.dampRate = o.dampRate;

        // Target = raw cursor NDC (whatever pointermove last fired).
        // Smoothed = lerped toward target each frame for that weighty feel.
        this._targetX = 0;
        this._targetY = 0;
        this._x = 0;
        this._y = 0;

        this._attached = false;
        this._onPointerMove = (e) => {
            const w = window.innerWidth || 1;
            const h = window.innerHeight || 1;
            // clientX/Y → NDC [-1, 1]; (+1,+1) is bottom-right (screen-Y grows down).
            this.setPointer((e.clientX / w) * 2 - 1, (e.clientY / h) * 2 - 1);
        };
        // Recenter when the cursor leaves the window or focus is lost so the
        // camera doesn't stay tilted while the user is away.
        this._onRecenter = () => {
            this._targetX = 0;
            this._targetY = 0;
        };
    }

    /** Set the pointer target directly in NDC ([-1, 1]). */
    setPointer(x, y) {
        this._targetX = Math.max(-1, Math.min(1, x));
        this._targetY = Math.max(-1, Math.min(1, y));
    }

    /** Start listening for pointer movement. Idempotent. */
    attach() {
        if (this._attached || typeof window === 'undefined') return;
        window.addEventListener('pointermove', this._onPointerMove, { passive: true });
        window.addEventListener('blur', this._onRecenter, { passive: true });
        document.addEventListener('mouseleave', this._onRecenter, { passive: true });
        this._attached = true;
    }

    /** Stop listening. Safe to call multiple times. */
    detach() {
        if (!this._attached) return;
        window.removeEventListener('pointermove', this._onPointerMove);
        window.removeEventListener('blur', this._onRecenter);
        document.removeEventListener('mouseleave', this._onRecenter);
        this._attached = false;
    }

    /**
     * Add the smoothed parallax offset to the camera's already-set position and
     * aim it at a cursor-drifted look-at point. Call once per frame, AFTER the
     * renderer has set the base camera position and BEFORE rendering.
     *
     * @param {{position: {x:number,y:number,z:number}, lookAt: Function}} camera
     * @param {number} delta seconds since last frame
     * @param {{x:number,y:number,z:number}} [focus] world point to frame (default origin)
     */
    apply(camera, delta, focus = null) {
        const damp = 1 - Math.exp(-this.dampRate * Math.max(0, delta || 0));
        this._x += (this._targetX - this._x) * damp;
        this._y += (this._targetY - this._y) * damp;

        const ox = this._x * this.orbitX;
        const oy = -this._y * this.orbitY; // screen-Y is flipped → negate
        camera.position.x += ox;
        camera.position.y += oy;
        camera.position.z += Math.abs(this._y) * this.orbitZ;

        const fx = focus ? focus.x : 0;
        const fy = focus ? focus.y : 0;
        const fz = focus ? focus.z : 0;
        camera.lookAt(fx + ox * this.lookAtGain, fy + oy * this.lookAtGain, fz);
    }
}
