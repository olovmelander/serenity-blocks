import * as THREE from 'three/webgpu';
import {
    uniform, attribute, normalWorld, normalize, clamp, vec3, vec2, float,
    positionWorld, cameraPosition, length, smoothstep, mix, pow, max, toneMapping,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneHierarchy } from 'three/addons/utils/SkeletonUtils.js';
import foxUrl from '../assets/arctic-fox.glb?url';
import {
    TWILIGHT_DIR, TWILIGHT_RADIANCE, MOON_RADIANCE, WARM_HORIZON,
    AMB_ZENITH, AMB_HORIZON, uAuroraAmbient,
} from '../lighting/winter-light-rig.js';

// ── Fur material, on the polar-twilight rig ─────────────────────────────────
// Rewritten 2026-08-13. The old version was `moon*0.38 + up*0.16 + 0.66` against
// a HARDCODED moon vector — a flat white blob lit by a direction that stopped
// being the scene's key light when the twilight rig landed. A creature that
// does not share the world's lighting reads as pasted on, no matter how good
// the mesh is; that, not polycount, is the gap against snowflow's character.
//
// Fur is a dense scatterer, so it gets the same treatment the snow does: light
// WRAPS almost all the way around it (no hard terminator on an animal), and the
// coat GLOWS at the silhouette when lit from behind. That backscatter rim is
// the single most expensive-looking thing about any furred creature, and under
// a key sitting 5.5° above the horizon our foxes are backlit nearly always.
const _MOON_DIR = new THREE.Vector3(1650, 1050, -2400).normalize();
const uFoxMoonDir = uniform(_MOON_DIR);
const uFoxRim = uniform(1.0);
const uFoxOut = uniform(2.6); // linear parity with the ground's uOutGain

function makeFurMaterial({ gradePreview = false } = {}) {
    const mat = new THREE.MeshBasicNodeMaterial();
    const albedoRaw = attribute('color').xyz; // TRELLIS vertex colours (coat + dark eyes/nose)
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = vec3(TWILIGHT_DIR.x, TWILIGHT_DIR.y, TWILIGHT_DIR.z);
    const M = uFoxMoonDir;
    const keyRad = vec3(TWILIGHT_RADIANCE.r, TWILIGHT_RADIANCE.g, TWILIGHT_RADIANCE.b);
    const moonRad = vec3(MOON_RADIANCE.r, MOON_RADIANCE.g, MOON_RADIANCE.b);
    const INV_PI = float(0.3183098862);
    const albedo = albedoRaw.mul(vec3(0.97, 0.985, 1.02));

    // Wrapped diffuse, wider than snow's — fur scatters harder than snowpack.
    const wrapD = (nl, w) => max(0.0, nl.add(w).div(float((1 + w) * (1 + w))));
    const direct = albedo.mul(INV_PI).mul(
        keyRad.mul(wrapD(N.dot(L), 0.85))
            .add(moonRad.mul(wrapD(N.dot(M), 0.6))),
    );

    // FUR BACKSCATTER RIM — light that entered the coat, scattered through it
    // and left toward the eye. Peaks on the silhouette with the light BEHIND,
    // which is exactly our twilight framing: a warm halo tracing every fox.
    const fres = pow(clamp(N.dot(V), 0.0, 1.0).oneMinus(), 2.4);
    const backK = clamp(V.dot(L).negate(), 0.0, 1.0);
    const backM = clamp(V.dot(M).negate(), 0.0, 1.0);
    const rim = keyRad.mul(pow(backK, 1.5)).mul(3.2)
        .add(moonRad.mul(pow(backM, 2.0)).mul(1.2))
        .mul(fres)
        .mul(uFoxRim)
        // Only the pale coat lights up; the dark eyes and nose must not glow.
        .mul(clamp(albedoRaw.x.mul(1.2).sub(0.15), 0.0, 1.0));

    // Ambient: the same night hemisphere + live aurora the snow reads, so the
    // fox sits in the world's light instead of carrying its own.
    const hemi = mix(
        vec3(AMB_HORIZON.r, AMB_HORIZON.g, AMB_HORIZON.b),
        vec3(AMB_ZENITH.r, AMB_ZENITH.g, AMB_ZENITH.b),
        N.y.mul(0.5).add(0.5),
    ).add(uAuroraAmbient.mul(0.5)).mul(1.55); // live aurora colour, shared with the snow
    const ambient = albedo.mul(INV_PI).mul(hemi);

    const lit = direct.add(rim).add(ambient).mul(uFoxOut);

    // Aerial perspective through the SAME haze the ground resolves to, warming
    // toward the twilight band — a far fox recedes into the air, it doesn't
    // just go grey.
    const viewV = positionWorld.sub(cameraPosition);
    const dist = length(viewV);
    const sunXZ = vec2(TWILIGHT_DIR.x, TWILIGHT_DIR.z);
    const vXZ = vec2(viewV.x, viewV.z);
    const along = clamp(
        vXZ.dot(sunXZ).div(vXZ.length().mul(sunXZ.length()).max(1e-4)),
        0.0,
        1.0,
    );
    const fogTint = vec3(0.07, 0.137, 0.227)
        .add(vec3(WARM_HORIZON.r, WARM_HORIZON.g, WARM_HORIZON.b).mul(pow(along, 3.0)).mul(0.10))
        .mul(uFoxOut);
    const fogged = mix(lit, fogTint, smoothstep(600.0, 3400.0, dist).mul(0.9));

    mat.colorNode = gradePreview
        ? toneMapping(THREE.ACESFilmicToneMapping, 0.82, fogged).mul(vec3(0.92, 0.97, 1.06))
        : clamp(fogged, 0.0, 6.0);
    return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arctic foxes that roam the winter snow + frozen lake and BEHAVE like real foxes.
//
// Mesh: a TRELLIS.2-generated arctic fox (vertex-coloured white fur + dark eyes),
// rigged in Blender with five baked clips: Run, Listen, Pounce, Shake, LookAround.
// The model faces +Z by default (Blender −Y forward → glTF +Z after export_yup),
// so heading = atan2(dirX, dirZ).
//
// Each fox wanders a smooth full-depth loop (ground-following snow + ice via a
// downward raycast), then occasionally stops and runs a behaviour: the iconic
// mousing HUNT (Listen → Pounce: leap + headfirst dive), a snow Shake, or an alert
// LookAround. See the behaviour state machine below.
// ─────────────────────────────────────────────────────────────────────────────

const _ray = new THREE.Raycaster();
const _down = new THREE.Vector3(0, -1, 0);
const _origin = new THREE.Vector3();

// ── Secondary motion scratch ────────────────────────────────────────────────
const _qP = new THREE.Quaternion();
const _qR = new THREE.Quaternion();
const _qT = new THREE.Quaternion();
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_FWD = new THREE.Vector3();
const _AX_RIGHT = new THREE.Vector3();

/**
 * Head trim, in DEGREES, correcting a tilt baked into the model's own rig.
 *
 * Measured 2026-08-13: the head bone sits at pitch 51.8° / yaw 20.5° / roll
 * 17.9° in body space. Most of that is just the bone's authored orientation
 * (a bone axis is an authoring convention and does NOT imply a visible tilt),
 * so this is deliberately a small artistic CORRECTION rather than an attempt
 * to zero those numbers — which would wrench the head off the neck.
 *
 * Tune live: `__winterDebug.headTrim(yaw, pitch, roll)`, then bake the values
 * you like in here. Positive yaw turns the muzzle toward the fox's right.
 */
const HEAD_TRIM = { yaw: 0, pitch: 0, roll: 0 };

// How fast a tail bone chases the clip's pose. The baked Run clip is not
// perfectly cyclic, so at the loop seam the tail — the longest, most mobile
// appendage — snaps; measured as a 4.9-unit one-frame jump of the tail tip
// while our own spring was provably smooth. Chasing the clip through a
// time-constant absorbs that discontinuity and, as a bonus, is exactly the
// inertia a heavy brush tail should have.
const TAIL_FOLLOW_RATE = 16;

/**
 * Add a WORLD-space rotation on top of whatever the clip put on a bone.
 *
 * Working in world space rather than the bone's local axes is the whole trick:
 * a GLB rig's bone orientations are an authoring accident (a tail bone's local
 * +Y may point along the tail, across it, or anywhere), so a local-axis swing
 * would twist instead of sweep on a rig we didn't author. `parent⁻¹ · R · parent`
 * expresses the world rotation in the bone's parent frame, so "swing about
 * world up" always reads as a horizontal swish.
 *
 * Called AFTER `mixer.update()`, and the mixer rewrites each bone from the clip
 * every frame, so this layers on cleanly and can never accumulate drift.
 */
function addWorldRotation(bone, axis, angle) {
    if (!bone.parent || Math.abs(angle) < 1e-5) return;
    bone.parent.getWorldQuaternion(_qP);
    _qR.setFromAxisAngle(axis, angle);
    _qT.copy(_qP).invert().multiply(_qR).multiply(_qP);
    bone.quaternion.premultiply(_qT);
}

/** As above, for an arbitrary world-space quaternion. */
function addWorldQuat(bone, q) {
    if (!bone.parent) return;
    bone.parent.getWorldQuaternion(_qP);
    _qT.copy(_qP).invert().multiply(q).multiply(_qP);
    bone.quaternion.premultiply(_qT);
}

// ── Two-bone IK scratch ─────────────────────────────────────────────────────
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _nrm = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cur = new THREE.Vector3();
const _want = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _tgt = new THREE.Vector3();

/**
 * Analytic two-bone IK: rotate `thigh` and `shin` so `paw` lands on `target`.
 *
 * Solved in world space in two aims, so it is independent of the rig's bone
 * axis conventions (see addWorldRotation). The bend-plane normal is taken from
 * the CURRENT pose, so the knee keeps bending the way the animation bends it —
 * that is what prevents the classic inverted-knee failure on a rig we did not
 * author.
 */
function solveLegIK(thigh, shin, paw, target) {
    thigh.getWorldPosition(_p0);
    shin.getWorldPosition(_p1);
    paw.getWorldPosition(_p2);
    const L1 = _p0.distanceTo(_p1);
    const L2 = _p1.distanceTo(_p2);
    if (L1 < 1e-4 || L2 < 1e-4) return;

    _dir.copy(target).sub(_p0);
    let d = _dir.length();
    if (d < 1e-5) return;
    _dir.divideScalar(d);
    // Never ask for a straighter-than-straight or folded-through-itself leg.
    d = THREE.MathUtils.clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);

    _v1.copy(_p1).sub(_p0);
    _v2.copy(_p2).sub(_p0);
    // (P2−P0) × (P1−P0): rotating `dir` about this by +hipAngle swings it TOWARD
    // the current knee, which is the side the leg is already bent to.
    _nrm.crossVectors(_v2, _v1);
    if (_nrm.lengthSq() < 1e-10) {
        _nrm.set(0, 0, 1).cross(_dir);
        if (_nrm.lengthSq() < 1e-10) _nrm.set(1, 0, 0).cross(_dir);
    }
    _nrm.normalize();

    // Law of cosines at the hip, then aim the thigh there.
    const hip = Math.acos(THREE.MathUtils.clamp(((L1 * L1) + (d * d) - (L2 * L2)) / (2 * L1 * d), -1, 1));
    _qA.setFromAxisAngle(_nrm, hip);
    _want.copy(_dir).applyQuaternion(_qA).normalize();
    _cur.copy(_p1).sub(_p0).normalize();
    _qB.setFromUnitVectors(_cur, _want);
    addWorldQuat(thigh, _qB);
    thigh.updateWorldMatrix(true, true);

    // The shin then simply points at the target from wherever the knee ended up.
    shin.getWorldPosition(_p1);
    paw.getWorldPosition(_p2);
    _cur.copy(_p2).sub(_p1).normalize();
    _want.copy(target).sub(_p1).normalize();
    _qB.setFromUnitVectors(_cur, _want);
    addWorldQuat(shin, _qB);
    shin.updateWorldMatrix(true, true);
}

// Real arctic foxes bias their mousing pounce toward magnetic NORTH (~73% success
// when aligned, ~18% otherwise) — they use Earth's field as a rangefinder. Here
// "north" is the −Z aurora horizon (auroras ring the magnetic pole), with a slight
// east declination, so the foxes consistently dive toward the aurora — an observant
// viewer notices they all pounce the same way. (heading: model faces +Z, so
// rotation.y = atan2(dirX, dirZ).)
const MAG_NORTH = new THREE.Vector2(0.42, -0.91); // NNE → toward the aurora
const MAG_NORTH_HEADING = Math.atan2(MAG_NORTH.x, MAG_NORTH.y);
// Paw-trail gait (fractions of the fox's length). Foxes are famous for the DIRECT-REGISTER
// trot: the hind foot lands in the print the front foot just made, so the trail is a single,
// nearly dead-straight line of marks — "as if the animal was walking on a tightrope", a
// "string of pearls". It is the most recognisable trail in the winter woods, and it is the
// opposite of a dog's two-abreast overstep trot. So: ONE mark per footfall on the body
// centre-line, with only a whisper of L/R offset, plus a shallow groove connecting them
// (in deep powder a fox plows as much as it steps — that groove is what makes the LANE read
// at distance, which is the whole game at this grazing camera).
const PAW_STRIDE = 0.55; // spacing between footfalls
const PAW_LATERAL = 0.022; // the barely-perceptible zig either side of the centre-line
// Where the print actually goes, as a fraction of the fox's length AHEAD of its
// ROOT (the root sits at the body centre; paws touch down well forward of it).
// Without this the prints materialise under the belly — which reads exactly as
// "the footprints are off from where the fox walks", because they are.
const PAW_FORWARD = 0.30;
// Footfalls are driven by the CLIP's own leg cycle, not by a free-running
// distance counter, so a print appears when a paw visibly lands. The trot is a
// two-beat gait → two footfalls per cycle. PAW_PHASE shifts the trigger to the
// clip's actual touchdown moment.
const GAIT_BEATS = 2;
const PAW_PHASE = 0.12;
// Fraction of a leg's cycle spent on the ground. A trot sits near 0.5; a touch
// over keeps at least one diagonal pair planted through the hand-off.
const STANCE_DUTY = 0.55;
// Held below 1 so the clip always retains a say — if the phase were ever wrong
// for a rig, this degrades to a slight drag rather than a locked, snapping leg.
const IK_STRENGTH = 0.85;
function approachAngle(a, b, rate, dt) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = rate * dt;
    return Math.abs(d) <= step ? b : a + Math.sign(d) * step;
}

export function createArcticFox(scene, {
    groundMeshes = [], // meshes to raycast for ground height (snow drifts + lake ice)
    groundMesh = null, // back-compat: a single ground mesh
    heightAt = null, // analytic ground height fn(x, z) → y — preferred over any raycast
    gradePreview = false, // playground-only: emulate the WinterPipeline grade in-material
    footIk = true, // foot-planting IK (?foxIk=0 disables, for A/B)
    fallbackY = -260, // FEET_Y if the raycast misses
    count = 3,
    scale = 190,
    footSink = 4, // how far the paws settle into the snow/ice
    // Foxes shrink with depth so the ones across the lake (~1km away, by the treeline +
    // peaks) read as tiny specks — beyond what perspective alone gives — selling the
    // vast distance. z ≥ nearZ → full size, z ≤ farZ → farScale, smooth between.
    nearZ = 250,
    farZ = -1500,
    farScale = 0.5,
    // Snow-deformation field (createPawTrail). Optional — null means the foxes leave no marks.
    trail = null,
    // Footfall powder (createSnowPuffs). Optional.
    puffs = null,
} = {}) {
    const group = new THREE.Group();
    group.name = 'winter-arctic-fox';
    scene.add(group);

    const loader = new GLTFLoader();
    let src = null; // { scene, clip }
    let disposed = false;
    let groundReady = false;
    const foxes = []; // { root, mixer, path, speed, t }
    const meshes = [groundMesh, ...groundMeshes].filter(Boolean);

    const disposeHierarchy = (root) => {
        root?.traverse?.((child) => {
            child.geometry?.dispose?.();
            const materials = Array.isArray(child.material)
                ? child.material
                : [child.material];
            materials.filter(Boolean).forEach((material) => material.dispose?.());
        });
        root?.clear?.();
    };

    // Raycast every ground mesh and take the HIGHEST hit so the fox stands on the
    // lake ice (above the carved basin floor) when over the lake, and on the snow
    // drifts everywhere else — a seamless snow⇄ice transition.
    function groundY(x, z) {
        // Analytic path: exact same math the ground mesh was displaced with —
        // always in sync, and no per-frame raycast against a dense heightfield.
        if (heightAt) return heightAt(x, z);
        if (!meshes.length) return fallbackY;
        if (!groundReady) { meshes.forEach((m) => m.updateMatrixWorld()); groundReady = true; }
        _origin.set(x, 2200, z);
        _ray.set(_origin, _down);
        let best = -Infinity;
        for (const m of meshes) {
            const hits = _ray.intersectObject(m, false);
            if (hits.length && hits[0].point.y > best) best = hits[0].point.y;
        }
        return best > -Infinity ? best : fallbackY;
    }

    // A big wandering loop that sweeps the FULL scene depth — from the far snow/ice
    // near the mountains (z≈−1800) right up close to the camera (z≈+430) and across
    // the width. Two harmonics keep it organic; results are clamped to the playable
    // rectangle (snow + frozen lake). Each fox gets its own centre/phase so the pack
    // spreads across the whole scene.
    function makePath(i) {
        const cx = (Math.random() - 0.5) * 360;
        const cz = -560 + (Math.random() - 0.5) * 220;
        const rx = 560 + Math.random() * 320; // narrower → stays in frame
        const rz = 1000 + Math.random() * 230; // deep: far treeline ⇄ near camera
        const dir = Math.random() < 0.5 ? 1 : -1;
        const ph = (i / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.8;
        return (t) => {
            const a = dir * t + ph;
            const x = cx + rx * Math.cos(a) + 110 * Math.cos(2.3 * a + 0.7);
            const z = cz + rz * Math.sin(a) + 95 * Math.sin(1.7 * a + 0.3);
            return {
                x: THREE.MathUtils.clamp(x, -1150, 1150),
                z: THREE.MathUtils.clamp(z, -1840, 430),
            };
        };
    }

    // ── Behaviour state machine ───────────────────────────────────────────────
    // Foxes trot the path, then occasionally STOP and behave like real arctic foxes:
    //   • hunt   : Listen (head cocks, localising prey) → POUNCE (leap + headfirst
    //              dive — the iconic mousing move; the vertical hop is a JS arc)
    //   • look   : alert LookAround (tail raised, scanning)
    //   • shake  : shake the snow off
    // Clips crossfade for smooth transitions.
    const STATE_CLIP = {
        trot: 'Run',
        listen: 'Listen',
        pounce: 'Pounce',
        shake: 'Shake',
        look: 'LookAround',
        stretch: 'Stretch',
        scratch: 'Scratch',
        dig: 'Dig',
        rest: 'CurlSleep',
    };

    // ── Snow marks ────────────────────────────────────────────────────────────
    // The ground REMEMBERS what happened on it. A fox that only marks the snow while trotting
    // is a fox that never pounced, dug or slept — and the mousing pounce is the best thing this
    // theme does. Frozen Wilds' whole trick is that you can retrace a fight from the snow.

    /** The fox's RENDERED size right now — it shrinks with depth, so far foxes mark small. */
    function renderScale(fx) {
        const k = THREE.MathUtils.smoothstep(fx.root.position.z, farZ, nearZ);
        return fx.modelScale * (farScale + (1 - farScale) * k);
    }

    /** Heading unit from the fox's facing (model faces +Z, so rotation.y = atan2(dirX, dirZ)). */
    function facing(fx) {
        return [Math.sin(fx.root.rotation.y), Math.cos(fx.root.rotation.y)];
    }

    /**
     * Tail + ear motion layered on top of the baked clip.
     *
     * The tail is a spring-damper driven by the fox's own TURN RATE: a heavy,
     * bushy tail cannot corner with the body, so it swings wide to the outside
     * of a turn and settles a beat late. That single beat of lag is what stops a
     * rigged animal reading as a puppet — it is the same reason snowflow spends
     * a Verlet solve on its character's coat rather than a normal map.
     */
    function secondaryMotion(fx, dt) {
        if (dt <= 0) return;
        fx.secT += dt;

        // Shortest-arc yaw delta → angular velocity.
        let dY = fx.root.rotation.y - fx.prevYaw;
        while (dY > Math.PI) dY -= Math.PI * 2;
        while (dY < -Math.PI) dY += Math.PI * 2;
        fx.prevYaw = fx.root.rotation.y;
        const yawRate = dY / dt;
        const moving = (fx.state === 'trot' || fx.state === 'greet') ? 1 : 0;

        // The fox's OWN axes. Yaw is heading-independent (world up is always
        // up), but PITCH is not: rotating about world X only pitches a fox that
        // happens to face ±Z — face it east or west and the very same rotation
        // becomes a ROLL, i.e. the head visibly cocks to one side. Since these
        // foxes walk a closed loop they hold those headings for long stretches,
        // which is precisely the "head always tilted left" report. Pitch must be
        // about the body's right axis. (Model faces +Z, so with heading y:
        // forward = (sin y, 0, cos y), right = (cos y, 0, −sin y).)
        const yy = fx.root.rotation.y;
        _AX_RIGHT.set(Math.cos(yy), 0, -Math.sin(yy));

        if (fx.tailBones.length) {
            // INERTIA FIRST: chase the clip's tail pose through a time constant
            // instead of adopting it outright. A heavy tail cannot change shape
            // instantaneously, and this is also what swallows the Run clip's
            // loop-seam pop (see TAIL_FOLLOW_RATE).
            const kf = 1 - Math.exp(-dt * TAIL_FOLLOW_RATE);
            for (let i = 0; i < fx.tailBones.length; i += 1) {
                const b = fx.tailBones[i];
                const prev = fx.tailPrevQ[i];
                prev.slerp(b.quaternion, kf); // prev ← toward the clip's new pose
                b.quaternion.copy(prev);
            }

            // Swing wide OPPOSITE the turn, plus a slow idle drift so a standing
            // fox is never perfectly still.
            const target = THREE.MathUtils.clamp(-yawRate * 0.22, -0.6, 0.6)
                + Math.sin(fx.secT * 2.1 + fx.tailPhase) * 0.06 * (0.4 + moving * 0.9);
            fx.tailV += ((target - fx.tailA) * 42 - fx.tailV * 8.5) * dt;
            fx.tailA += fx.tailV * dt;
            // Carriage: a trotting fox streams its tail out behind and slightly
            // up; a resting one lets it drop.
            const liftTarget = moving ? 0.16 : -0.05;
            fx.tailLiftV += ((liftTarget - fx.tailLift) * 18 - fx.tailLiftV * 6) * dt;
            fx.tailLift += fx.tailLiftV * dt;
            const n = fx.tailBones.length;
            for (let i = 0; i < n; i += 1) {
                const w = (i + 1) / n; // lag deepens toward the tip
                addWorldRotation(fx.tailBones[i], _AX_Y, fx.tailA * w * 0.9);
                addWorldRotation(fx.tailBones[i], _AX_RIGHT, fx.tailLift * w * 0.8);
            }
        }

        if (fx.headBone) {
            // GAZE STABILISATION, high-passed.
            //
            // Driving this off raw yaw RATE holds the head permanently cocked to
            // one side, because these foxes walk a closed loop and are therefore
            // turning gently the same way essentially forever — the spring just
            // settles at that constant offset. A real animal only resists a
            // CHANGE in heading; through a steady curve it carries its head
            // straight. So the sustained component is absorbed by a slow
            // follower and only the transient drives the head.
            const follow = Math.min(1, dt * 1.5);
            fx.yawRateSmooth += (yawRate - fx.yawRateSmooth) * follow;
            const transient = yawRate - fx.yawRateSmooth;
            const hTarget = THREE.MathUtils.clamp(-transient * 0.10, -0.26, 0.26);
            fx.headV += ((hTarget - fx.headA) * 70 - fx.headV * 12) * dt;
            fx.headA += fx.headV * dt;

            // Idle glances — the "alive" half. Two slow sines at an irrational
            // frequency ratio never repeat, so the fox keeps looking around
            // without ever reading as a metronome. Damped while trotting,
            // because a moving animal mostly watches where it is going.
            const gain = moving ? 0.55 : 1.0;
            const glanceY = (Math.sin(fx.secT * 0.37 + fx.tailPhase) * 0.55
                + Math.sin(fx.secT * 0.239 + fx.tailPhase * 2.1) * 0.45) * 0.14 * gain;
            const glanceX = (Math.sin(fx.secT * 0.31 + fx.tailPhase * 1.7) * 0.6
                + Math.sin(fx.secT * 0.173 + fx.tailPhase * 0.6) * 0.4) * 0.06 * gain;

            addWorldRotation(fx.headBone, _AX_Y, fx.headA + glanceY + HEAD_TRIM.yaw);
            addWorldRotation(fx.headBone, _AX_RIGHT, glanceX + HEAD_TRIM.pitch
                + (moving ? Math.sin(fx.secT * 5.4 + fx.tailPhase * 0.7) * 0.035 : 0));
            // Roll about the fox's own forward axis, so the trim stays true
            // whichever way it walks.
            if (Math.abs(HEAD_TRIM.roll) > 1e-5) {
                _AX_FWD.set(Math.sin(yy), 0, Math.cos(yy));
                addWorldRotation(fx.headBone, _AX_FWD, HEAD_TRIM.roll);
            }
        }

        if (fx.earBones.length) {
            // Ears flick on their own schedule and prick forward when the fox is
            // listening for the mouse under the snow.
            fx.earTimer -= dt;
            if (fx.earTimer <= 0) {
                fx.earTimer = 1.4 + Math.random() * 3.4;
                fx.earFlick = 1;
            }
            fx.earFlick = Math.max(0, fx.earFlick - dt * 5.5);
            const listening = (fx.state === 'listen' || fx.state === 'pounce') ? 1 : 0;
            const flick = Math.sin(fx.earFlick * Math.PI) * 0.2;
            for (let i = 0; i < fx.earBones.length; i += 1) {
                const side = i % 2 === 0 ? 1 : -1;
                // _AX_RIGHT, not a world-X axis: the ears pitch about the BODY's right
                // axis for the same reason the head does (see the axis note above) —
                // this line still referenced the deleted _AX_X, so it threw a
                // ReferenceError on every frame a fox with ear bones was animated.
                addWorldRotation(fx.earBones[i], _AX_RIGHT, listening * -0.12 - flick * 0.45);
                addWorldRotation(fx.earBones[i], _AX_Y, flick * side);
            }
        }
    }

    /**
     * FOOT PLANTING — the trick that separates "animated" from "grounded".
     *
     * snowflow's formulation: "a foot's world position is written exactly once,
     * on touchdown, and held absolutely fixed while two-bone IK reaches for it —
     * a planted foot cannot slide because nothing in the code is able to move
     * it." That is this, verbatim: on touchdown we capture the paw's FK world
     * position and freeze it; through stance the leg is solved to that frozen
     * point while the body travels on, so the paw stays welded to the snow.
     *
     * The gait phase comes from the CLIP (whose timeScale is already matched to
     * ground speed), so IK and the visible legs can never disagree about which
     * foot is down — and it is the same phase the paw-trail stamps fire on, so a
     * print now appears exactly where and when a foot actually plants.
     */
    function footPlant(fx) {
        if (!footIk || !fx.legs.length || fx.state !== 'trot') {
            for (let i = 0; i < fx.legs.length; i += 1) { fx.legs[i].planted = false; fx.legs[i].w = 0; }
            return;
        }
        const clip = fx.current?.getClip?.();
        if (!clip || clip.duration <= 1e-4) return;
        const base = ((fx.current.time / clip.duration) + PAW_PHASE) % 1;
        for (let i = 0; i < fx.legs.length; i += 1) {
            const leg = fx.legs[i];
            const p = (base + leg.off) % 1;
            if (p < STANCE_DUTY) {
                const s = p / STANCE_DUTY; // 0..1 through the stance
                if (!leg.planted) {
                    leg.planted = true;
                    leg.paw.getWorldPosition(leg.target); // written ONCE, then frozen
                }
                // Ease in at touchdown and out at lift-off. At touchdown the held
                // target IS the FK pose, so easing in cannot pop; easing out
                // hands the leg back to the clip before it swings.
                const easeIn = THREE.MathUtils.clamp(s / 0.12, 0, 1);
                const easeOut = THREE.MathUtils.clamp((1 - s) / 0.18, 0, 1);
                leg.w = Math.min(easeIn, easeOut) * IK_STRENGTH;
            } else {
                leg.planted = false;
                leg.w = 0;
            }
            if (leg.w > 0.01) {
                // Blend FK → held target by weight, so the solve is continuous.
                leg.paw.getWorldPosition(_tgt);
                _tgt.lerp(leg.target, leg.w);
                solveLegIK(leg.thigh, leg.shin, leg.paw, _tgt);
            }
        }
    }

    /** The snow SURFACE under a fox (root sits `footSink` into it). */
    function surfaceY(fx) {
        return fx.root.position.y + footSink;
    }

    /**
     * Lay down a direct-register print ON a footfall.
     *
     * `beat` (optional) is the gait-cycle crossing that triggered this call; when
     * present the print is synced to the CLIP's leg cycle, so a mark appears at
     * the moment a paw visibly lands instead of on a free-running odometer. The
     * distance accumulator is kept as a guard so a stalled or clamped animation
     * can never machine-gun prints on the spot.
     */
    function footfall(fx, x, z, ux, uz, moved, beat = false) {
        if (!trail && !puffs) return;
        fx.trailDist += moved;
        const s = renderScale(fx);
        const minGap = s * PAW_STRIDE * 0.45;
        if (beat ? fx.trailDist < minGap : fx.trailDist < s * PAW_STRIDE) return;
        fx.trailDist = 0;
        const off = s * PAW_LATERAL * fx.footSide;
        // Forward to the paw, not the belly: the touchdown point is ahead of the
        // root, and in a direct-register trot the hind paw re-lands in it.
        const fwd = s * PAW_FORWARD;
        const px = x + ux * fwd + uz * off;
        const pz = z + uz * fwd - ux * off;
        if (trail) {
            // The plow groove first, so the print then presses into it, not the other way.
            if (fx.hasPaw) trail.stampDrag(fx.lastPawX, fx.lastPawZ, px, pz, s);
            trail.stampPaw(px, pz, ux, uz, s);
        }
        // A trotting paw only whispers powder up — the eruptions are saved for the pounce.
        if (puffs) puffs.burst(px, surfaceY(fx), pz, s, ux, uz, 2, 0.45);
        fx.lastPawX = px;
        fx.lastPawZ = pz;
        fx.hasPaw = true;
        fx.footSide = -fx.footSide;
    }

    function play(fx, name, once, timeScale = 1) {
        const next = fx.actions[name];
        if (!next) return;
        next.reset();
        next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
        next.clampWhenFinished = once;
        next.enabled = true;
        next.setEffectiveTimeScale(timeScale);
        next.setEffectiveWeight(1);
        next.play();
        if (fx.current && fx.current !== next) next.crossFadeFrom(fx.current, 0.25, false);
        fx.current = next;
    }
    function setState(fx, s) {
        fx.state = s; fx.stateTime = 0;
        // Break the plow groove whenever the fox stops travelling, so a pause doesn't get
        // stitched to wherever it resumes.
        if (s !== 'trot') fx.hasPaw = false;
        if (s === 'trot') {
            play(fx, 'Run', false, 1); // timeScale matched to ground speed in update()
            fx.trotDur = 7 + Math.random() * 9;
            return;
        }
        if (s === 'pounce' && trail) {
            // Take-off: the hind legs drive and kick a smear of snow BACKWARD.
            const [ux, uz] = facing(fx);
            trail.stampScuff(fx.basePos.x, fx.basePos.z, ux, uz, renderScale(fx));
            fx.pounceLanded = false;
        }
        if (s === 'dig') fx.digTimer = 0;
        if (s === 'listen') {
            // aim the coming pounce toward magnetic north (mostly) — the rest are the
            // foxes' less-aligned, lower-success attempts.
            fx.pounceHeading = Math.random() < 0.75
                ? MAG_NORTH_HEADING + (Math.random() - 0.5) * 0.5 // ≈ north ±14°
                : Math.random() * Math.PI * 2; // an "off" pounce
        }
        if (s === 'rest') {
            const a = fx.actions.CurlSleep;
            play(fx, 'CurlSleep', true, 0.6); // a slow nap: curl → sleep (breathing) → uncurl
            fx.stateDur = a ? a.getClip().duration / 0.6 : 4.5;
            fx.restMark = 0; // the body impression deepens as it settles (see update())
            return;
        }
        const action = fx.actions[STATE_CLIP[s]];
        play(fx, STATE_CLIP[s], true, 1);
        fx.stateDur = action ? action.getClip().duration : 1.0;
    }
    function startBehavior(fx) {
        const r = Math.random();
        if (r < 0.30) setState(fx, 'listen'); // → the hunt (listen then pounce)
        else if (r < 0.45) setState(fx, 'look');
        else if (r < 0.57) setState(fx, 'shake');
        else if (r < 0.69) setState(fx, 'scratch');
        else if (r < 0.81) setState(fx, 'dig');
        else if (r < 0.91) setState(fx, 'stretch');
        else setState(fx, 'rest'); // curl up to sleep → wake → stretch
    }
    function advanceState(fx) {
        if (fx.state === 'listen') setState(fx, 'pounce'); // the mousing hunt sequence
        else if (fx.state === 'rest') setState(fx, 'stretch'); // wake up with a stretch
        else setState(fx, 'trot');
    }

    // ── Greeting: when two foxes' paths cross they may stop to say hello ──
    // (adapted from sakura-twilight): proximity → %-chance → bow / hop / circle,
    // facing each other, then they part with a cooldown.
    const GREET_DIST = 320; // world units — "stumble upon" range (~4 fox lengths)
    const GREET_CHANCE = 0.6; // chance to greet on an encounter
    const GREET_DURATION = 3.0; // seconds
    function startGreeting(a, b) {
        const type = Math.floor(Math.random() * 3); // 0 bow · 1 hop · 2 circle
        const mid = a.root.position.clone().add(b.root.position).multiplyScalar(0.5);
        for (const [fx, partner] of [[a, b], [b, a]]) {
            fx.state = 'greet'; fx.stateTime = 0; fx.stateDur = GREET_DURATION;
            fx.hasPaw = false; // don't stitch a groove from wherever it was trotting
            fx.greetPartner = partner; fx.greetType = type; fx.greetMid = mid;
            fx.basePos.copy(fx.root.position);
            fx.greetRadius = Math.hypot(fx.root.position.x - mid.x, fx.root.position.z - mid.z);
            fx.greetAng0 = Math.atan2(fx.root.position.z - mid.z, fx.root.position.x - mid.x);
            play(fx, 'Greet', false, 1); // loops for the greeting duration
        }
        console.log(`[ArcticFox] greeting (${['bow', 'hop', 'circle'][type]})`);
    }
    // Pounce vertical hop, normalised τ over the clip: a small crouch dip, then a
    // hop that peaks mid-clip and lands by ~0.82 (matching the clip's dive→impact).
    function leapHeight(tau) {
        if (tau < 0.18) return -0.12 * Math.sin(Math.PI * tau / 0.18);
        const u = (tau - 0.18) / 0.64;
        return u >= 1 ? 0 : Math.sin(Math.PI * u);
    }
    function lungeAmt(tau) {
        return Math.max(0, Math.sin(Math.PI * tau)) * (tau < 0.6 ? 1 : 0.45);
    }

    async function load() {
        let gltf;
        try {
            gltf = await loader.loadAsync(foxUrl);
        } catch (e) {
            if (!disposed) {
                console.warn('[ArcticFox] failed to load arctic-fox.glb:', e);
            }
            return;
        }
        if (disposed) {
            disposeHierarchy(gltf.scene);
            return;
        }
        gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            const oldMaterials = Array.isArray(o.material) ? o.material : [o.material];
            oldMaterials.filter(Boolean).forEach((material) => material.dispose?.());
            o.material = makeFurMaterial({ gradePreview }); // polar-twilight fur (TSL)
            o.frustumCulled = false;
            o.castShadow = false;
        });
        const clips = {};
        (gltf.animations ?? []).forEach((c) => { clips[c.name] = c; });
        src = { scene: gltf.scene, clips };
        for (let i = 0; i < count; i += 1) spawn(i);
        console.log(`[ArcticFox] loaded — ${foxes.length} foxes, clips=[${Object.keys(clips).join(', ')}]`);
    }

    function spawn(i) {
        if (disposed || !src) return;
        const root = new THREE.Group();
        const model = cloneHierarchy(src.scene);
        const s = scale * (0.85 + Math.random() * 0.3);
        model.scale.setScalar(s);
        root.add(model);
        group.add(root);

        const mixer = new THREE.AnimationMixer(model);
        const actions = {};
        for (const name in src.clips) actions[name] = mixer.clipAction(src.clips[name]);

        // Secondary-motion rig: the tail chain and the ears, found BY NAME so a
        // rig without them simply gets no extra motion instead of an error. An
        // arctic fox's tail is nearly half its length and enormously bushy —
        // baked clip motion alone makes it read as a stiff prop, and lag on it
        // is the cheapest "this animal is alive" cue there is.
        // This rig (verified): spine, neck, head, tail1..3, and thigh/shin/paw
        // per leg — 18 bones. No ear bones, so that path simply stays idle.
        const tailBones = [];
        const earBones = [];
        let headBone = null;
        model.traverse((o) => {
            if (!o.isBone) return;
            const n = (o.name || '').toLowerCase();
            if (n.includes('tail')) tailBones.push(o);
            else if (n.includes('ear')) earBones.push(o);
            else if (!headBone && n.includes('head')) headBone = o;
        });
        // Root-most first so the lag can deepen toward the tip (a whip, not a plank).
        const boneDepth = (b) => { let d = 0; let p = b; while (p) { d += 1; p = p.parent; } return d; };
        tailBones.sort((a, b) => boneDepth(a) - boneDepth(b));

        // Leg chains for foot-planting IK. A trot is a two-beat DIAGONAL gait:
        // front-right + back-left swing together, then front-left + back-right —
        // hence the half-cycle offsets.
        const boneByName = {};
        model.traverse((o) => { if (o.isBone) boneByName[(o.name || '').toLowerCase()] = o; });
        const legs = [];
        [['fr', 0], ['bl', 0], ['fl', 0.5], ['br', 0.5]].forEach(([tag, off]) => {
            const thigh = boneByName[`thigh${tag}`];
            const shin = boneByName[`shin${tag}`];
            const pawB = boneByName[`paw${tag}`];
            if (thigh && shin && pawB) {
                legs.push({
                    thigh, shin, paw: pawB, off, planted: false, w: 0, target: new THREE.Vector3(),
                });
            }
        });

        const fx = {
            root,
            model,
            mixer,
            actions,
            path: makePath(i),
            // SLOW travel so the vast scene (~1km to the mountains) takes a long
            // journey to cross — not seconds. The trot's leg cycle is matched to this
            // ground speed each frame in update() so it never foot-skates.
            speed: 0.045 + Math.random() * 0.022,
            modelScale: s,
            t: Math.random() * Math.PI * 2,
            leapAmp: s * 1.25, // hop ≈ ~2× the fox's height (the real mousing leap)
            lungeAmp: s * 0.5,
            state: '',
            stateTime: 0,
            stateDur: 0,
            trotDur: 0,
            pounceHeading: MAG_NORTH_HEADING,
            greetCooldown: Math.random() * 4,
            greetPartner: null,
            greetType: 0,
            greetMid: new THREE.Vector3(),
            greetRadius: 0,
            greetAng0: 0,
            basePos: new THREE.Vector3(),
            prevX: 0,
            prevZ: 0,
            hasPrev: false,
            trailDist: 0,
            footSide: 1, // paw-trail gait accumulator + L/R alternation
            // Secondary motion state (spring-damper on the tail, flick timer on the ears).
            tailBones,
            tailPrevQ: tailBones.map((b) => b.quaternion.clone()),
            earBones,
            headBone,
            legs,
            headA: 0,
            headV: 0,
            yawRateSmooth: 0,
            tailA: 0,
            tailV: 0,
            tailLift: 0,
            tailLiftV: 0,
            tailPhase: Math.random() * Math.PI * 2,
            secT: Math.random() * 10,
            prevYaw: 0,
            earTimer: 1 + Math.random() * 3,
            earFlick: 0,
            lastPawX: 0,
            lastPawZ: 0,
            hasPaw: false, // previous print → the plow groove is drawn from it
            pounceLanded: false,
            digTimer: 0,
            restMark: 0,
            gcY: fallbackY,
            gcValid: false,
            rayPhase: i % 3, // amortized ground-raycast cache
            current: null,
        };
        foxes.push(fx);
        setState(fx, 'trot');
        fx.stateTime = Math.random() * fx.trotDur; // stagger so they don't sync up
    }

    let _frame = 0;
    function update(dt) {
        if (disposed) return;
        _frame += 1;
        // Greeting encounters: tick cooldowns, then pair-check trotting foxes.
        for (const fx of foxes) if (fx.greetCooldown > 0) fx.greetCooldown -= dt;
        for (let i = 0; i < foxes.length; i += 1) {
            const a = foxes[i];
            if (a.state !== 'trot' || a.greetCooldown > 0) continue;
            for (let j = i + 1; j < foxes.length; j += 1) {
                const b = foxes[j];
                if (b.state !== 'trot' || b.greetCooldown > 0) continue;
                const dx = a.root.position.x - b.root.position.x;
                const dz = a.root.position.z - b.root.position.z;
                if (dx * dx + dz * dz < GREET_DIST * GREET_DIST) {
                    if (Math.random() < GREET_CHANCE) startGreeting(a, b);
                    else { a.greetCooldown = 4; b.greetCooldown = 4; } // passed by
                    break;
                }
            }
        }
        for (const fx of foxes) {
            if (fx.mixer) fx.mixer.update(dt);
            fx.stateTime += dt;
            fx.root.userData.foxState = fx.state;
            if (fx.state === 'trot') {
                fx.t += dt * fx.speed;
                const p = fx.path(fx.t);
                const pn = fx.path(fx.t + 0.03); // lookahead → heading
                // Amortize the ground raycast: foxes move slowly over smooth ground, so a
                // raycast every 3rd frame (staggered per fox) and reused between is visually
                // identical to per-frame, at ~3× fewer O(n) raycasts against the drift mesh.
                if (!fx.gcValid || (_frame % 3) === fx.rayPhase) {
                    fx.gcY = groundY(p.x, p.z);
                    fx.gcValid = true;
                }
                const gy = fx.gcY - footSink;
                fx.root.position.set(p.x, gy, p.z);
                const hx = pn.x - p.x;
                const hz = pn.z - p.z;
                if (hx * hx + hz * hz > 1e-5) fx.root.rotation.y = Math.atan2(hx, hz);
                fx.basePos.set(p.x, gy, p.z);
                // Match the trot's leg cadence to the actual ground speed so the slow
                // travel never foot-skates (stride distance per cycle scales with size).
                if (fx.hasPrev && dt > 1e-4 && fx.current) {
                    const mx = p.x - fx.prevX;
                    const mz = p.z - fx.prevZ;
                    const groundSpeed = Math.sqrt(mx * mx + mz * mz) / dt;
                    const strideRate = fx.modelScale * 0.66; // units/s the clip strides at timeScale 1
                    fx.current.setEffectiveTimeScale(THREE.MathUtils.clamp(groundSpeed / strideRate, 0.25, 2.2));
                }
                // Direct-register trot → a single-file string of prints joined by a
                // plow groove, laid ON the clip's own leg beats so each mark
                // coincides with a paw you can see touch the snow.
                if (fx.hasPrev) {
                    const mvx = p.x - fx.prevX;
                    const mvz = p.z - fx.prevZ;
                    const hl = Math.sqrt(hx * hx + hz * hz) || 1;
                    let beat = false;
                    const clip = fx.current?.getClip?.();
                    if (clip && clip.duration > 1e-4) {
                        const ph = ((fx.current.time / clip.duration) + PAW_PHASE) % 1;
                        const b = Math.floor(ph * GAIT_BEATS);
                        if (fx.lastBeat !== b) { beat = fx.lastBeat !== undefined; fx.lastBeat = b; }
                    }
                    footfall(
                        fx,
                        p.x,
                        p.z,
                        hx / hl,
                        hz / hl,
                        Math.sqrt(mvx * mvx + mvz * mvz),
                        beat,
                    );
                }
                fx.prevX = p.x; fx.prevZ = p.z; fx.hasPrev = true;
                if (fx.stateTime >= fx.trotDur) startBehavior(fx);
            } else if (fx.state === 'greet') {
                const partner = fx.greetPartner;
                if (partner) { // turn to face the friend
                    const px = partner.root.position.x - fx.root.position.x;
                    const pz = partner.root.position.z - fx.root.position.z;
                    if (px * px + pz * pz > 1) {
                        fx.root.rotation.y = approachAngle(fx.root.rotation.y, Math.atan2(px, pz), 4.0, dt);
                    }
                }
                const tau = THREE.MathUtils.clamp(fx.stateTime / fx.stateDur, 0, 1);
                if (fx.greetType === 1) { // excited hops
                    const hop = Math.max(0, Math.sin(tau * Math.PI * 4)) * (1 - tau * 0.4);
                    fx.root.position.set(fx.basePos.x, fx.basePos.y + hop * fx.modelScale * 0.45, fx.basePos.z);
                } else if (fx.greetType === 2) { // circle around each other
                    const ang = fx.greetAng0 + tau * Math.PI * 2;
                    const cx = fx.greetMid.x + Math.cos(ang) * fx.greetRadius;
                    const cz = fx.greetMid.z + Math.sin(ang) * fx.greetRadius;
                    const moved = Math.hypot(cx - fx.root.position.x, cz - fx.root.position.z);
                    fx.root.position.set(cx, groundY(cx, cz) - footSink, cz);
                    // Two foxes greeting tread a little ring into the snow — a story you can
                    // still read after they've wandered off.
                    const [gx, gz] = facing(fx);
                    footfall(fx, cx, cz, gx, gz, moved);
                } else { // bow — stay put
                    fx.root.position.copy(fx.basePos);
                }
                if (fx.stateTime >= fx.stateDur) {
                    setState(fx, 'trot');
                    fx.greetCooldown = 12 + Math.random() * 6;
                    fx.greetPartner = null;
                }
            } else {
                // While listening (and through the pounce) turn to face magnetic north.
                if (fx.state === 'listen' || fx.state === 'pounce') {
                    fx.root.rotation.y = approachAngle(fx.root.rotation.y, fx.pounceHeading, 2.6, dt);
                }
                if (fx.state === 'pounce') {
                    const tau = THREE.MathUtils.clamp(fx.stateTime / Math.max(0.01, fx.stateDur), 0, 1);
                    const f = lungeAmt(tau) * fx.lungeAmp;
                    fx.root.position.set(
                        fx.basePos.x + Math.sin(fx.root.rotation.y) * f,
                        fx.basePos.y + leapHeight(tau) * fx.leapAmp,
                        fx.basePos.z + Math.cos(fx.root.rotation.y) * f,
                    );
                    // IMPACT. leapHeight() lands the arc by tau ≈ 0.82 — the headfirst dive
                    // punches a deep, high-lipped crater with four splayed paw marks around it.
                    // The signature moment of the whole theme, and until now it left no mark.
                    if (!fx.pounceLanded && tau >= 0.82) {
                        fx.pounceLanded = true;
                        const [ux, uz] = facing(fx);
                        const s = renderScale(fx);
                        if (trail) trail.stampCrater(fx.root.position.x, fx.root.position.z, ux, uz, s);
                        // …and the powder ERUPTS. This is the theme's money shot.
                        if (puffs) {
                            const { x: cx, z: cz } = fx.root.position;
                            puffs.burst(cx, surfaceY(fx), cz, s, ux, uz, 12, 1.5);
                        }
                    }
                } else if (fx.state === 'rest') {
                    // sink to lie down as it curls, rise as it uncurls (matches the clip)
                    const tau = THREE.MathUtils.clamp(fx.stateTime / Math.max(0.01, fx.stateDur), 0, 1);
                    const env = tau < 0.25 ? tau / 0.25 : (tau > 0.8 ? Math.max(0, (1 - tau) / 0.2) : 1);
                    fx.root.position.set(fx.basePos.x, fx.basePos.y - env * fx.modelScale * 0.30, fx.basePos.z);
                    // A sleeping fox slowly presses a wide, soft body hollow into the powder —
                    // stamped in a few instalments so it DEEPENS as the fox settles.
                    if (trail && env > 0.2 && fx.restMark < 4 && fx.stateTime > fx.restMark * 0.5) {
                        fx.restMark += 1;
                        const [ux, uz] = facing(fx);
                        trail.stampBody(fx.basePos.x, fx.basePos.z, ux, uz, renderScale(fx), 0.4);
                    }
                } else if (fx.state === 'dig') {
                    // Digging throws snow backward in a scattered fan.
                    fx.digTimer -= dt;
                    if (fx.digTimer <= 0) {
                        fx.digTimer = 0.18;
                        const [ux, uz] = facing(fx);
                        const s = renderScale(fx);
                        if (trail) trail.stampDig(fx.basePos.x, fx.basePos.z, ux, uz, s, fx.stateTime);
                        if (puffs) {
                            const dx = fx.basePos.x + ux * s * 0.1;
                            const dz = fx.basePos.z + uz * s * 0.1;
                            puffs.burst(dx, surfaceY(fx), dz, s, ux, uz, 3, 0.9);
                        }
                    }
                } else {
                    fx.root.position.copy(fx.basePos);
                }
                if (fx.stateTime >= fx.stateDur) advanceState(fx);
            }
        }

        // Scale-perspective: shrink each fox by its current depth so the far ones
        // read as tiny specks — beyond what perspective alone gives.
        for (const fx of foxes) {
            const k = THREE.MathUtils.smoothstep(fx.root.position.z, farZ, nearZ);
            fx.model.scale.setScalar(fx.modelScale * (farScale + (1 - farScale) * k));
            secondaryMotion(fx, dt);
            footPlant(fx);
        }
    }

    /** Live head-trim tuning, in degrees (see HEAD_TRIM). */
    function setHeadTrim(yaw = 0, pitch = 0, roll = 0) {
        HEAD_TRIM.yaw = (yaw * Math.PI) / 180;
        HEAD_TRIM.pitch = (pitch * Math.PI) / 180;
        HEAD_TRIM.roll = (roll * Math.PI) / 180;
        return { yaw, pitch, roll };
    }

    function dispose() {
        if (disposed) return;
        disposed = true;
        for (const fx of foxes) { if (fx.mixer) fx.mixer.stopAllAction(); group.remove(fx.root); }
        foxes.length = 0;
        disposeHierarchy(src?.scene);
        src = null;
        group.clear();
        scene.remove(group);
    }

    // debug handle (harmless): inspect/stage fox behaviours from the console
    group.userData.foxes = foxes;
    group.userData.setFoxState = setState;
    group.userData.forceGreet = () => { if (foxes.length >= 2) startGreeting(foxes[0], foxes[1]); };

    return {
        group, load, update, dispose, setHeadTrim,
    };
}
