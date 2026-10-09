/**
 * Supernova — gameplay effects that are their own geometry.
 *
 *  - Streams: what the board feeds the star. A lock leaves the card as a ribbon of the piece's
 *    colour that bends in toward the star and falls onto its surface; the cleared rows go the
 *    same way, faster and whiter. Each is a closed-form curve with a bright head and a tail.
 *  - Sparks: ejecta. Streaks that leave a point fast, drag to a halt in the thin gas and go out:
 *    the spray where a stream lands, the debris a shock throws, the knots of a detonation.
 *  - Embers: the star's wind. Motes that leave the star, spiral outward and fade, on a clock the
 *    gameplay bends: a chain blows harder, a collapse draws them back in, a detonation hurls
 *    them out.
 *  - Beams: the two beams of the pulsar a detonation leaves, sweeping like a lighthouse while
 *    the new star kindles.
 *
 * Nothing is created at event time and every pool is always drawn (dormant slots collapse to
 * zero size), so the first frame compiles every pipeline.
 */

import * as THREE from 'three/webgpu';
import {
    Fn,
    abs,
    attribute,
    cameraPosition,
    cameraProjectionMatrix,
    cameraViewMatrix,
    clamp,
    cos,
    cross,
    dot,
    exp,
    float,
    fract,
    instanceIndex,
    length,
    max,
    mix,
    normalize,
    positionGeometry,
    sin,
    smoothstep,
    step,
    uv,
    varying,
    vec2,
    vec3,
    vec4,
} from 'three/tsl';
import {
    BLUEWHITE,
    STREAM_SEGMENTS,
    STREAM_SLOTS,
    TAU,
    mulberry32,
    snFxMaterial,
    snPart,
    snPastStar,
    snQuadGeometry,
    snStripGeometry,
    snTurnY,
} from './supernova-tsl.js';

const viewProjection = (world) => cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(world, 1.0));

// ── Streams ─────────────────────────────────────────────────────────────────────

/** How much of its path a stream's tail covers. */
export const STREAM_TAIL = 0.46;

/** The point of a stream's curve at `k` (0 = the card, 1 = the star). CPU twin of the shader. */
export function streamPoint(from, mid, to, k, out = [0, 0, 0]) {
    const a = (1 - k) * (1 - k);
    const b = 2 * k * (1 - k);
    const c = k * k;
    for (let i = 0; i < 3; i++) out[i] = from[i] * a + mid[i] * b + to[i] * c;
    return out;
}

/** @param {object} u shared uniforms */
export function createStreams(u) {
    const count = STREAM_SLOTS;
    const aFrom = new Float32Array(count * 4);
    const aCtrl = new Float32Array(count * 4);
    const aTo = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        aFrom.set([0, 0, -300, -100], i * 4);
        aCtrl[i * 4 + 3] = 1;
        aTo.set([0, 1, 0, 0], i * 4);
    }
    const geometry = snStripGeometry(count, STREAM_SEGMENTS, {
        aFrom: [aFrom, 4], aCtrl: [aCtrl, 4], aTo: [aTo, 4], aTint: [aTint, 4],
    });
    const names = ['aFrom', 'aCtrl', 'aTo', 'aTint'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const from = attribute('aFrom', 'vec4');
    const ctrl = attribute('aCtrl', 'vec4');
    const to = attribute('aTo', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = snFxMaterial('SupernovaStreams');
    const lag = positionGeometry.x;
    const head = u.time.sub(from.w).div(max(ctrl.w, 0.01));
    const raw = head.sub(lag.mul(STREAM_TAIL));
    const alive = step(0.0, head).mul(step(head, 1.0 + STREAM_TAIL));
    // It lands on the star where the star is NOW: the spot turns with it, and a collapse draws it in.
    const target = u.centre.add(u.starRot.mul(to.xyz).mul(u.starR));
    const middle = from.xyz.add(target).mul(0.5).add(ctrl.xyz);
    const curve = (sIn) => {
        const s = clamp(sIn, 0.0, 1.0);
        // It leaves the card gently and falls faster and faster.
        const k = mix(s, s.mul(s), 0.62);
        const a = float(1.0).sub(k).mul(float(1.0).sub(k));
        const b = k.mul(float(1.0).sub(k)).mul(2.0);
        return from.xyz.mul(a).add(middle.mul(b)).add(target.mul(k.mul(k)));
    };
    const world = curve(raw);
    const ahead = curve(raw.add(0.03));
    const along = normalize(ahead.sub(world).add(vec3(1e-5, 0.0, 0.0)));
    const side = normalize(cross(along, world.sub(cameraPosition)).add(vec3(0.0, 1e-6, 0.0)));
    // The part still on the card, and the part already in the star, have no width.
    const inFlight = step(0.0, raw).mul(step(raw, 1.0));
    const taper = float(1.0).sub(lag).pow(0.8).mul(0.92)
        .add(0.08);
    // It leaves the card much nearer the eye than the star is. Its width is scaled by how far
    // off it is, so it is as wide on screen when it leaves as when it lands.
    const nearness = length(world.sub(cameraPosition)).div(length(u.centre.sub(cameraPosition)));
    const width = tint.w.mul(taper).mul(alive).mul(inFlight).mul(nearness);
    const placed = world.add(side.mul(positionGeometry.y).mul(width));
    material.vertexNode = viewProjection(placed);

    const vLag = varying(lag, 'snStreamLag');
    const vAcross = varying(positionGeometry.y, 'snStreamY');
    const vTint = varying(tint.rgb, 'snStreamTint');
    const vGain = varying(alive.mul(inFlight).mul(smoothstep(0.0, 0.08, head)), 'snStreamGain');
    const vWorld = varying(placed, 'snStreamWorld');
    const vKind = varying(to.w, 'snStreamKind');
    material.colorNode = Fn(() => {
        const y = clamp(vAcross, -1.0, 1.0);
        const l = clamp(vLag, 0.0, 1.0);
        const core = exp(y.mul(y).mul(-16.0));
        const sheath = exp(y.mul(y).mul(-2.6)).mul(0.42);
        // A lantern at the head, a tail that thins to nothing.
        const tail = float(1.0).sub(l);
        const lantern = exp(l.mul(l).mul(-70.0)).mul(7.0);
        const body = tail.mul(tail).mul(2.4);
        const white = mix(vTint, vec3(1.0, 0.97, 0.92), core.mul(mix(float(0.55), float(0.85), vKind)));
        const light = white.mul(core.add(sheath)).mul(body.add(lantern));
        return vec4(light.mul(vGain).mul(snPastStar(u, vWorld)), 0.0);
    })();

    const part = snPart('SupernovaStreams', geometry, material, 40);
    let cursor = 0;
    const touch = () => names.forEach((name) => {
        geometry.getAttribute(name).needsUpdate = true;
    });
    /**
     * Send a stream from a world point to the point of the star's surface in direction `dir`
     * (a unit vector of the star's frame). `bow` bends the path (a world offset of its middle).
     * `kind` 0 = a piece, 1 = a cleared row (whiter).
     */
    part.launch = ({
        from: f, dir, bow = [0, 0, 0], rgb, time, flight, size = 0.12, kind = 0,
    }) => {
        const slot = cursor % count;
        cursor += 1;
        aFrom.set([f[0], f[1], f[2], time], slot * 4);
        aCtrl.set([bow[0], bow[1], bow[2], flight], slot * 4);
        aTo.set([dir[0], dir[1], dir[2], kind], slot * 4);
        aTint.set([rgb[0], rgb[1], rgb[2], size], slot * 4);
        touch();
        return slot;
    };
    part.reset = () => {
        cursor = 0;
        for (let i = 0; i < count; i++) aFrom[i * 4 + 3] = -100;
        touch();
    };
    part.count = count;
    return part;
}

// ── Sparks ──────────────────────────────────────────────────────────────────────

/** How fast a spark slows in the thin gas (1/s). */
const SPARK_DRAG = 1.9;

/**
 * @param {object} u shared uniforms
 * @param {number} count
 */
export function createSparks(u, count) {
    const aBirth = new Float32Array(count * 4);
    const aVel = new Float32Array(count * 4);
    const aTint = new Float32Array(count * 4);
    // Dormant sparks wait far ahead of the camera, never on it.
    for (let i = 0; i < count; i++) aBirth.set([0, 0, -500, -100], i * 4);
    const geometry = snQuadGeometry(count, { aBirth: [aBirth, 4], aVel: [aVel, 4], aTint: [aTint, 4] });
    const names = ['aBirth', 'aVel', 'aTint'];
    names.forEach((name) => geometry.getAttribute(name).setUsage(THREE.DynamicDrawUsage));
    const birth = attribute('aBirth', 'vec4');
    const vel = attribute('aVel', 'vec4');
    const tint = attribute('aTint', 'vec4');

    const material = snFxMaterial('SupernovaSparks');
    const tau = u.time.sub(birth.w);
    const span = vel.w;
    const alive = step(0.0, tau).mul(step(tau, span));
    const at = (t) => birth.xyz.add(vel.xyz.mul(float(1.0).sub(exp(t.mul(-SPARK_DRAG))).div(SPARK_DRAG)));
    // A streak from where the spark was a moment ago to where it is.
    const t = max(tau, 0.0);
    const c0 = viewProjection(at(max(t.sub(0.06), 0.0)));
    const c1 = viewProjection(at(t));
    const along = positionGeometry.x.add(0.5);
    const half = u.viewport.mul(0.5);
    const s0 = c0.xy.div(c0.w).mul(half);
    const s1 = c1.xy.div(c1.w).mul(half);
    const dir = normalize(s1.sub(s0).add(vec2(1e-4, 0.0)));
    const nrm = vec2(dir.y.negate(), dir.x);
    const clip = mix(c0, c1, along);
    const widthPx = max(tint.w.div(max(clip.w, 1.0).mul(u.pixelAngle)), u.viewport.y.mul(0.0015)).mul(alive);
    const lead = dir.mul(along.sub(0.5).mul(2.0)).mul(widthPx);
    material.vertexNode = vec4(
        clip.xy.add(nrm.mul(positionGeometry.y.mul(2.0).mul(widthPx)).add(lead).div(half).mul(clip.w)),
        clip.z,
        clip.w,
    );
    const ageK = clamp(t.div(max(span, 0.01)), 0.0, 1.0);
    const fade = float(1.0).sub(ageK).mul(float(1.0).sub(ageK));
    const glitter = sin(t.mul(tint.w.mul(40.0).add(11.0)).add(birth.x.mul(13.0))).mul(0.3).add(0.7);
    const hot = mix(vec3(1.0, 0.97, 0.94), tint.rgb, smoothstep(0.0, 0.3, ageK));
    const vLight = varying(hot.mul(fade).mul(glitter).mul(alive).mul(3.2), 'snSpark');
    material.colorNode = Fn(() => {
        const st = uv();
        const across = float(1.0).sub(abs(st.y.sub(0.5)).mul(2.0));
        const tail = smoothstep(0.0, 0.8, st.x);
        return vec4(vLight.mul(across.mul(across)).mul(tail), 0.0);
    })();

    const part = snPart('SupernovaSparks', geometry, material, 45);
    let cursor = 0;
    let bursts = 0;
    let dirtyFrom = Infinity;
    let dirtyTo = -1;
    let wrapped = false;
    /**
     * Throw `n` sparks from a world point at `time` (which may be a moment ahead). They leave
     * round `axis` (a world unit vector): `spread` 0 = straight along it, 1 = every way. `out` =
     * (min, max) speed in star radii per second.
     */
    part.emit = ({
        x, y, z, n, rgb, time, axis = [0, 1, 0], spread = 1, out = [3, 12], life = [0.6, 1.5], size = 0.035,
        stagger = 0, from = 0,
    }) => {
        const rand = mulberry32(0x5eed + bursts * 7919);
        bursts += 1;
        const total = Math.min(Math.max(0, Math.round(n)), count);
        for (let j = 0; j < total; j++) {
            const i = cursor % count;
            if (cursor > 0 && i === 0) wrapped = true;
            cursor += 1;
            // A point on the unit sphere, drawn in toward the axis.
            const zc = rand() * 2 - 1;
            const bearing = rand() * TAU;
            const ring = Math.sqrt(Math.max(0, 1 - zc * zc));
            let vx = Math.cos(bearing) * ring * spread + axis[0] * (1 - spread * 0.5);
            let vy = Math.sin(bearing) * ring * spread + axis[1] * (1 - spread * 0.5);
            let vz = zc * spread + axis[2] * (1 - spread * 0.5);
            const len = Math.hypot(vx, vy, vz) || 1;
            const speed = out[0] + (out[1] - out[0]) * rand() ** 1.7;
            vx = (vx / len) * speed;
            vy = (vy / len) * speed;
            vz = (vz / len) * speed;
            // `from`: it starts this far along its own way (off the star's surface, not inside it).
            aBirth.set([x + (vx / speed) * from, y + (vy / speed) * from, z + (vz / speed) * from,
                time + rand() * stagger], i * 4);
            aVel.set([vx, vy, vz, life[0] + (life[1] - life[0]) * rand()], i * 4);
            const lift = 0.75 + rand() * 0.5;
            aTint.set([rgb[0] * lift, rgb[1] * lift, rgb[2] * lift, size * (0.6 + rand() * 0.9)], i * 4);
            if (i < dirtyFrom) dirtyFrom = i;
            if (i > dirtyTo) dirtyTo = i;
        }
    };
    /** Upload what this frame's bursts wrote (one range, or everything when the ring wrapped). */
    part.flush = () => {
        if (dirtyTo < 0) return;
        names.forEach((name) => {
            const attr = geometry.getAttribute(name);
            attr.clearUpdateRanges();
            if (!wrapped) attr.addUpdateRange(dirtyFrom * 4, (dirtyTo - dirtyFrom + 1) * 4);
            attr.needsUpdate = true;
        });
        dirtyFrom = Infinity;
        dirtyTo = -1;
        wrapped = false;
    };
    part.reset = () => {
        cursor = 0;
        bursts = 0;
        for (let i = 0; i < count; i++) aBirth[i * 4 + 3] = -100;
        dirtyFrom = 0;
        dirtyTo = count - 1;
        wrapped = true;
        part.flush();
    };
    part.count = count;
    return part;
}

// ── Embers ──────────────────────────────────────────────────────────────────────

/** How far an ember gets before it fades (star radii). */
const EMBER_REACH = 15;

/**
 * @param {object} u shared uniforms
 * @param {number} count
 * @param {number} [seed]
 */
export function createEmbers(u, count, seed = 0xe3be5) {
    const rand = mulberry32(seed);
    const aSeed = new Float32Array(count * 4);
    const aLook = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
        const z = rand() * 2 - 1;
        const bearing = rand() * TAU;
        const ring = Math.sqrt(Math.max(0, 1 - z * z));
        aSeed.set([Math.cos(bearing) * ring, z * 0.8, Math.sin(bearing) * ring, rand()], i * 4);
        // speed, size, hue, swirl
        aLook.set([0.55 + rand() * 0.9, 0.012 + rand() ** 3 * 0.035, rand(), (rand() - 0.5) * 2.4], i * 4);
    }
    const geometry = snQuadGeometry(count, { aSeed: [aSeed, 4], aLook: [aLook, 4] });
    const seedAttr = attribute('aSeed', 'vec4');
    const look = attribute('aLook', 'vec4');

    const material = snFxMaterial('SupernovaEmbers');
    const phase = fract(seedAttr.w.add(u.flow.mul(look.x).mul(0.022)));
    const radius = float(1.15).add(phase.pow(1.25).mul(EMBER_REACH));
    const dir = normalize(snTurnY(seedAttr.xyz, look.w.mul(phase)));
    const world = u.centre.add(dir.mul(radius));
    const clip = viewProjection(world);
    const half = u.viewport.mul(0.5);
    const fade = smoothstep(0.0, 0.05, phase).mul(float(1.0).sub(smoothstep(0.5, 1.0, phase)));
    const px = max(look.y.div(max(clip.w, 0.5).mul(u.pixelAngle)), u.viewport.y.mul(0.0011));
    material.vertexNode = vec4(clip.xy.add(positionGeometry.xy.mul(px.mul(2.0)).div(half).mul(clip.w)), clip.z, clip.w);
    const cool = mix(u.gasC, u.gasA, look.z);
    const tintNode = mix(mix(u.starHot, vec3(1.0), 0.3), cool, smoothstep(0.04, 0.5, phase));
    const twinkle = sin(u.time.mul(look.x.mul(3.0).add(1.0)).add(seedAttr.w.mul(61.0))).mul(0.3).add(0.7);
    const gain = fade.mul(twinkle).mul(float(2.4).div(float(1.0).add(radius.mul(0.3))));
    const vLight = varying(tintNode.mul(gain).mul(snPastStar(u, world)), 'snEmber');
    material.colorNode = Fn(() => {
        const q = uv().sub(0.5).mul(2.0);
        const d = length(q);
        const dot2 = exp(d.mul(d).mul(-7.0)).mul(float(1.0).sub(smoothstep(0.7, 1.0, d)));
        return vec4(vLight.mul(dot2).mul(u.breath), 0.0);
    })();

    const part = snPart('SupernovaEmbers', geometry, material, 35);
    part.count = count;
    return part;
}

// ── The pulsar's beams ──────────────────────────────────────────────────────────

/** How far the beams lean from the pulsar's axis. */
const BEAM_CONE = 1.12;

/** @param {object} u shared uniforms */
export function createBeams(u) {
    const geometry = snStripGeometry(2, 12);
    const material = snFxMaterial('SupernovaBeams');
    const sign = float(1.0).sub(float(instanceIndex).mul(2.0));
    const phase = u.pulsar.y;
    const local = vec3(cos(phase).mul(Math.sin(BEAM_CONE)), Math.cos(BEAM_CONE), sin(phase).mul(Math.sin(BEAM_CONE)));
    const beamDir = normalize(u.starRot.mul(local)).mul(sign);
    const s = positionGeometry.x;
    const world = u.centre.add(beamDir.mul(u.starR.mul(0.6).add(s.mul(u.pulsar.z))));
    const side = normalize(cross(beamDir, world.sub(cameraPosition)).add(vec3(0.0, 1e-6, 0.0)));
    const width = float(0.05).add(s.mul(0.085).mul(u.pulsar.z)).mul(step(0.002, u.pulsar.x));
    const placed = world.add(side.mul(positionGeometry.y).mul(width));
    material.vertexNode = viewProjection(placed);
    // The beam flares as it sweeps past the eye.
    const toEye = normalize(cameraPosition.sub(u.centre));
    const facing = max(dot(beamDir, toEye), 0.0);
    const sweep = facing.mul(facing).mul(facing).mul(facing);
    const vGain = varying(u.pulsar.x.mul(float(0.55).add(sweep.mul(sweep).mul(7.0))), 'snBeamGain');
    const vS = varying(s, 'snBeamS');
    const vY = varying(positionGeometry.y, 'snBeamY');
    const vWorld = varying(placed, 'snBeamWorld');
    material.colorNode = Fn(() => {
        const y = clamp(vY, -1.0, 1.0);
        const along = clamp(vS, 0.0, 1.0);
        const core = exp(y.mul(y).mul(-30.0)).mul(0.8).add(exp(y.mul(y).mul(-3.2)).mul(0.35));
        const reach = float(1.0).sub(along);
        const light = mix(vec3(...BLUEWHITE), u.rim, along.mul(0.6)).mul(core).mul(reach.mul(reach)).mul(1.6);
        return vec4(light.mul(vGain).mul(snPastStar(u, vWorld)), 0.0);
    })();
    return snPart('SupernovaBeams', geometry, material, 15);
}
