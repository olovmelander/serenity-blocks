/**
 * Runtime-owned camera director for Koi Pond.
 *
 * Pointer events only update a bounded intent. The director applies an exact
 * critically damped response from the single render clock, keeping camera
 * motion deterministic, allocation-free, and independent from frame rate.
 */
import {
    KOI_POND_LAYOUT,
    resolveKoiPondCameraPose,
} from './koi-pond-layout.js';

const MAX_DELTA_SECONDS = 0.05;

/**
 * Idle camera breathing, in WORLD UNITS applied after the pointer pose.
 *
 * It deliberately does NOT live inside the -1..1 pointer space: that space is
 * clamped, so a strong breath there would eat the cursor's range and flatten the
 * parallax. Keeping it a separate world offset lets both be strong at once.
 *
 * Two detuned sines per axis (periods with no common multiple) so the drift
 * never visibly loops. The target swings the opposite way from the eye on X,
 * which turns a slide into a slow orbital SWAY — much more legible as breathing
 * than pure translation.
 */
const BREATH = Object.freeze({
    posX: [
        { rate: 0.125, amp: 2.05 },
        { rate: 0.052, amp: 1.15 },
    ],
    posY: [
        { rate: 0.098, amp: 0.62 },
        { rate: 0.041, amp: 0.34 },
    ],
    posZ: [
        { rate: 0.067, amp: 0.72 },
        { rate: 0.029, amp: 0.38 },
    ],
    targetX: [
        { rate: 0.125, amp: -0.62 },
        { rate: 0.043, amp: 0.28 },
    ],
    targetY: [
        { rate: 0.089, amp: 0.20 },
    ],
});

/**
 * Slow WANDER, layered on top of the breath.
 *
 * Breathing is the fast, small sway that keeps the shot alive; this is the long
 * journey underneath it — the camera genuinely travelling left/right/up/down
 * around the sanctuary over several minutes. Periods here are 5-12x longer than
 * the breath, so the two never beat against each other and the combined path
 * feels hand-flown rather than mechanical.
 */
const WANDER = Object.freeze({
    posX: [
        { rate: 0.0212, amp: 2.10 },
        { rate: 0.0131, amp: 1.10 },
    ],
    posY: [
        { rate: 0.0173, amp: 1.05 },
        { rate: 0.0107, amp: 0.58 },
    ],
    posZ: [
        { rate: 0.0146, amp: 1.45 },
        { rate: 0.0092, amp: 0.80 },
    ],
    targetX: [
        { rate: 0.0212, amp: -1.05 },
        { rate: 0.0118, amp: 0.55 },
    ],
    targetY: [
        { rate: 0.0163, amp: 0.42 },
    ],
});

const PHASES = Object.freeze({
    posX: [0, 1.27],
    posY: [0.63, 2.11],
    posZ: [1.94, 0.42],
    targetX: [0, 2.68],
    targetY: [1.51],
});

const WANDER_PHASES = Object.freeze({
    posX: [2.31, 0.84],
    posY: [1.06, 3.02],
    posZ: [0.29, 2.47],
    targetX: [2.31, 1.73],
    targetY: [0.88],
});

function sampleAxis(spec, phases, time) {
    let total = 0;
    for (let i = 0; i < spec.length; i += 1) {
        total += Math.sin(time * spec[i].rate + (phases[i] || 0)) * spec[i].amp;
    }
    return total;
}

function clampUnit(value) {
    const numeric = Number(value);
    return Math.max(-1, Math.min(1, Number.isFinite(numeric) ? numeric : 0));
}

function soften(value) {
    return value * (0.78 + Math.abs(value) * 0.22);
}

function stepCriticalSpring(current, velocity, target, delta, frequency, output) {
    const omega = Math.PI * 2 * frequency;
    const offset = current - target;
    const decay = Math.exp(-omega * delta);
    const transient = (velocity + omega * offset) * delta;
    output.value = target + (offset + transient) * decay;
    output.velocity = (velocity - omega * transient) * decay;
    return output;
}

export function createKoiPondCameraDirector({
    camera,
    reducedMotion = false,
} = {}) {
    if (!camera?.position?.set || typeof camera.lookAt !== 'function') {
        throw new TypeError('Koi Pond camera director requires a perspective camera');
    }

    const initial = {
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
        position: camera.position.clone?.() || {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z,
        },
        quaternion: camera.quaternion?.clone?.() || null,
    };
    const pointer = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    const velocity = { x: 0, y: 0 };
    const springX = { value: 0, velocity: 0 };
    const springY = { value: 0, velocity: 0 };
    const posePointer = { x: 0, y: 0 };
    const pose = {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
    };
    // Ambient "breathing" drift. The sanctuary should never sit perfectly still,
    // so the camera always sways on its own; pointer parallax is ADDED on top of
    // this rather than replacing it. Two detuned sines per axis (periods that do
    // not share a common multiple) keep the path from ever visibly repeating.
    const breath = {
        posX: 0, posY: 0, posZ: 0, targetX: 0, targetY: 0,
    };
    let breathTime = 0;
    let motionReduced = reducedMotion === true;
    let disposed = false;

    function sampleBreath(time) {
        // Fast sway (breath) + slow travel (wander), summed per axis.
        breath.posX = sampleAxis(BREATH.posX, PHASES.posX, time)
            + sampleAxis(WANDER.posX, WANDER_PHASES.posX, time);
        breath.posY = sampleAxis(BREATH.posY, PHASES.posY, time)
            + sampleAxis(WANDER.posY, WANDER_PHASES.posY, time);
        breath.posZ = sampleAxis(BREATH.posZ, PHASES.posZ, time)
            + sampleAxis(WANDER.posZ, WANDER_PHASES.posZ, time);
        breath.targetX = sampleAxis(BREATH.targetX, PHASES.targetX, time)
            + sampleAxis(WANDER.targetX, WANDER_PHASES.targetX, time);
        breath.targetY = sampleAxis(BREATH.targetY, PHASES.targetY, time)
            + sampleAxis(WANDER.targetY, WANDER_PHASES.targetY, time);
    }

    function clearBreath() {
        breath.posX = 0;
        breath.posY = 0;
        breath.posZ = 0;
        breath.targetX = 0;
        breath.targetY = 0;
    }

    function apply(activeCamera = camera) {
        if (disposed || !activeCamera) return;
        const aspect = Number(activeCamera.aspect);
        const aspectGain = Number.isFinite(aspect)
            ? Math.max(0.58, Math.min(1, aspect / 1.4))
            : 1;
        posePointer.x = current.x * aspectGain;
        posePointer.y = current.y;
        resolveKoiPondCameraPose(posePointer, pose);
        // Ambient breath is a WORLD-space offset laid over the pointer pose, so
        // the two are independent: a strong sway never clamps away the parallax.
        activeCamera.position.set(
            pose.position.x + breath.posX,
            pose.position.y + breath.posY,
            pose.position.z + breath.posZ,
        );
        activeCamera.lookAt(
            pose.target.x + breath.targetX,
            pose.target.y + breath.targetY,
            pose.target.z,
        );

        const cameraLayout = KOI_POND_LAYOUT.camera;
        if (
            activeCamera.fov !== cameraLayout.fov
            || activeCamera.near !== cameraLayout.near
            || activeCamera.far !== cameraLayout.far
        ) {
            activeCamera.fov = cameraLayout.fov;
            activeCamera.near = cameraLayout.near;
            activeCamera.far = cameraLayout.far;
            activeCamera.updateProjectionMatrix?.();
        }
    }

    function reset({ immediate = false } = {}) {
        pointer.x = 0;
        pointer.y = 0;
        if (immediate || motionReduced) {
            current.x = 0;
            current.y = 0;
            velocity.x = 0;
            velocity.y = 0;
            apply();
        }
    }

    return {
        apply,
        setPointer(x, y, { immediate = false } = {}) {
            if (disposed || motionReduced) return;
            pointer.x = soften(clampUnit(x));
            pointer.y = soften(clampUnit(y));
            if (immediate) {
                current.x = pointer.x;
                current.y = pointer.y;
                velocity.x = 0;
                velocity.y = 0;
                apply();
            }
        },
        reset,
        setReducedMotion(enabled) {
            motionReduced = enabled === true;
            if (motionReduced) reset({ immediate: true });
        },
        update(time, delta = 1 / 60) {
            if (disposed) return;
            const safeDelta = Math.max(
                0,
                Math.min(MAX_DELTA_SECONDS, Number(delta) || 0),
            );
            // The sanctuary breathes on its own. Prefer the caller's absolute
            // clock so phase-locked `?t=` captures stay reproducible, and fall
            // back to accumulating delta when no clock is supplied.
            const sampled = Number(time);
            breathTime = Number.isFinite(sampled) && sampled > 0
                ? sampled
                : breathTime + safeDelta;
            if (motionReduced) clearBreath();
            else sampleBreath(breathTime);
            const targetX = motionReduced ? 0 : pointer.x;
            const targetY = motionReduced ? 0 : pointer.y;
            const frequency = KOI_POND_LAYOUT.camera.parallax.springFrequency;
            const nextX = stepCriticalSpring(
                current.x,
                velocity.x,
                targetX,
                safeDelta,
                frequency,
                springX,
            );
            const nextY = stepCriticalSpring(
                current.y,
                velocity.y,
                targetY,
                safeDelta,
                frequency,
                springY,
            );
            current.x = nextX.value;
            current.y = nextY.value;
            velocity.x = nextX.velocity;
            velocity.y = nextY.velocity;
            apply();
        },
        getDiagnostics() {
            return {
                pointer: { ...pointer },
                current: { ...current },
                breath: { ...breath },
                reducedMotion: motionReduced,
                springFrequency: KOI_POND_LAYOUT.camera.parallax.springFrequency,
            };
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            camera.fov = initial.fov;
            camera.near = initial.near;
            camera.far = initial.far;
            camera.position.copy?.(initial.position);
            if (initial.quaternion && camera.quaternion?.copy) {
                camera.quaternion.copy(initial.quaternion);
            }
            camera.updateProjectionMatrix?.();
        },
    };
}
